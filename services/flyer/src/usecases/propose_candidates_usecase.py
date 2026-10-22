"""ウィザードの候補生成。

タイプ → 背景 → 配置 → 配色 の 4 ステップを、同じ背景の上で決定的に描く。
候補はすべて「文字まで合成した完成イメージ」で、確定時は再描画せずそのまま
保存する。選んだ見た目と完成品がずれない。
"""

from __future__ import annotations

from uuid import uuid4

from src.adapters.candidate_source.palettes import (
    PALETTES,
    Palette,
    default_palette,
    palette_for,
)
from src.adapters.candidate_source.templates import (
    TEMPLATE_DESCRIPTIONS,
    TEMPLATE_LABELS,
)
from src.adapters.renderer.layouts import LAYOUT_DESCRIPTIONS, LAYOUT_LABELS
from src.domain.exceptions import CandidateNotFoundError
from src.domain.models import (
    CandidateItem,
    CandidateKind,
    CandidateList,
    CandidateMeta,
    FlyerGenerationRequest,
    LLMGenerationContext,
    TemplateId,
    TextLayout,
)
from src.infrastructure.storage.local_candidate_store import LocalCandidateStore
from src.ports.candidate_source_port import CandidateSourcePort
from src.ports.image_upload_port import ImageUploadPort
from src.ports.prompt_engine_port import PromptEnginePort
from src.ports.renderer_port import FlyerRendererPort


def context_with_palette(
    context: LLMGenerationContext,
    palette: Palette,
) -> LLMGenerationContext:
    """配色ステップの選択を反映したコンテキストを作る。"""
    return context.model_copy(
        update={
            "suggested_accent_color": palette.accent_color,
            "suggested_overlay_alpha": palette.overlay_alpha,
        }
    )


class ProposeCandidatesUseCase:
    """4 ステップ分のタイルを組み立てる。"""

    def __init__(
        self,
        prompt_engine: PromptEnginePort,
        source: CandidateSourcePort,
        renderer: FlyerRendererPort,
        store: LocalCandidateStore,
        uploads: ImageUploadPort,
    ) -> None:
        self._prompt_engine = prompt_engine
        self._source = source
        self._renderer = renderer
        self._store = store
        self._uploads = uploads

    async def suggest_types(
        self,
        request: FlyerGenerationRequest,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 1。3 テンプレートを標準配置・既定配色で描く。"""
        context = await self._prompt_engine.generate_prompt_context(request)
        items: list[CandidateItem] = []
        for template_id in TemplateId:
            palette = default_palette(template_id)
            background = await self._source.preview_background(template_id)
            items.append(
                self._make(
                    kind=CandidateKind.TYPE,
                    request=request.model_copy(
                        update={
                            "template_id": template_id,
                            "layout_id": TextLayout.CLASSIC,
                        }
                    ),
                    context=context_with_palette(context, palette),
                    background=background,
                    palette=palette,
                    layout=TextLayout.CLASSIC,
                    parent_id=None,
                    label=TEMPLATE_LABELS[template_id],
                    description=TEMPLATE_DESCRIPTIONS[template_id],
                    owner_token_hash=owner_token_hash,
                )
            )
        return CandidateList(candidates=items)

    async def suggest_backgrounds(
        self,
        request: FlyerGenerationRequest,
        count: int,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 2。選んだタイプの背景を複数枚描く。"""
        context = await self._prompt_engine.generate_prompt_context(request)
        palette = default_palette(request.template_id)
        options = await self._source.suggest_backgrounds(request, context, count)
        items = [
            self._make(
                kind=CandidateKind.BACKGROUND,
                request=request,
                context=context_with_palette(context, palette),
                background=option.background,
                palette=palette,
                layout=request.layout_id,
                parent_id=None,
                label=option.label,
                description=option.description,
                owner_token_hash=owner_token_hash,
            )
            for option in options
        ]
        return CandidateList(candidates=items)

    async def create_uploaded_background(
        self,
        request: FlyerGenerationRequest,
        payload: bytes,
        owner_token_hash: str | None = None,
    ) -> CandidateItem:
        """ステップ 2。持ち込まれた写真を 1 枚の背景候補にする。

        形式検証・EXIF 除去・9:16 の中央クロップは `ImageUploadPort` が行う。
        候補を作るだけなので、生成回数は消費しない。
        """
        background = self._uploads.normalize(payload)
        palette = default_palette(request.template_id)
        context = await self._prompt_engine.generate_prompt_context(request)
        return self._make(
            kind=CandidateKind.BACKGROUND,
            request=request,
            context=context_with_palette(context, palette),
            background=background,
            palette=palette,
            layout=request.layout_id,
            parent_id=None,
            label="自分の写真",
            description="中央を9:16で切り抜いた背景",
            owner_token_hash=owner_token_hash,
            source="upload",
        )

    def suggest_layouts(
        self,
        parent_id: str,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 3。同じ背景のまま 4 通りの配置を描く。"""
        meta = self._load_owned_meta(parent_id, owner_token_hash)
        background = self._store.load_background(parent_id)
        palette = palette_for(meta.palette_id, meta.template_id)
        items = [
            self._make(
                kind=CandidateKind.LAYOUT,
                request=meta.request.model_copy(update={"layout_id": layout}),
                context=meta.context,
                background=background,
                palette=palette,
                layout=layout,
                parent_id=parent_id,
                label=LAYOUT_LABELS[layout],
                description=LAYOUT_DESCRIPTIONS[layout],
                owner_token_hash=meta.owner_token_hash,
            )
            for layout in TextLayout
        ]
        return CandidateList(candidates=items)

    def suggest_palettes(
        self,
        parent_id: str,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 4。選んだ配置のまま 4 通りの配色を描く。"""
        meta = self._load_owned_meta(parent_id, owner_token_hash)
        background = self._store.load_background(parent_id)
        items = [
            self._make(
                kind=CandidateKind.PALETTE,
                request=meta.request,
                context=context_with_palette(meta.context, palette),
                background=background,
                palette=palette,
                layout=meta.layout_id,
                parent_id=parent_id,
                label=palette.label,
                description=palette.description,
                owner_token_hash=meta.owner_token_hash,
            )
            for palette in PALETTES
        ]
        return CandidateList(candidates=items)

    def finalize(
        self,
        candidate_id: str,
        owner_token_hash: str | None = None,
    ) -> tuple[bytes, CandidateMeta]:
        """確定。選ばれた完成画像とメタを返す。再描画しない。"""
        meta = self._load_owned_meta(candidate_id, owner_token_hash)
        return self._store.load(candidate_id), meta

    def read_image(
        self,
        candidate_id: str,
        owner_token_hash: str | None = None,
    ) -> bytes:
        """候補画像。所有者が違えば存在しないものとして扱う。"""
        self._load_owned_meta(candidate_id, owner_token_hash)
        return self._store.load(candidate_id)

    def _load_owned_meta(
        self,
        candidate_id: str,
        owner_token_hash: str | None,
    ) -> CandidateMeta:
        meta = self._store.load_meta(candidate_id)
        # 所有者なしの古い候補（デプロイ前の TTL 内）は、従来どおり ID だけで読める。
        if meta.owner_token_hash and meta.owner_token_hash != owner_token_hash:
            raise CandidateNotFoundError(
                f"candidate {candidate_id} belongs to another owner"
            )
        return meta

    def _make(
        self,
        *,
        kind: CandidateKind,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
        background: bytes,
        palette: Palette,
        layout: TextLayout,
        parent_id: str | None,
        label: str,
        description: str,
        owner_token_hash: str | None = None,
        source: str | None = None,
    ) -> CandidateItem:
        image = self._renderer.render_flyer(
            background_bytes=background,
            request=request,
            context=context,
        )
        candidate_id = str(uuid4())
        meta = CandidateMeta(
            candidate_id=candidate_id,
            kind=kind,
            template_id=request.template_id,
            layout_id=layout,
            palette_id=palette.palette_id,
            accent_color=palette.accent_color,
            overlay_alpha=palette.overlay_alpha,
            parent_id=parent_id,
            label=label,
            description=description,
            source=source or self._source.source_id,
            owner_token_hash=owner_token_hash,
            request=request,
            context=context,
        )
        image_url = self._store.save(candidate_id, image, background, meta)
        return CandidateItem(
            candidate_id=candidate_id,
            kind=kind,
            label=label,
            description=description,
            image_url=image_url,
            template_id=request.template_id,
            layout_id=layout,
            palette_id=palette.palette_id,
            accent_color=palette.accent_color,
            overlay_alpha=palette.overlay_alpha,
        )


__all__ = ["ProposeCandidatesUseCase", "context_with_palette"]
