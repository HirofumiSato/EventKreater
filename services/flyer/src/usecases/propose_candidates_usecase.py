"""ウィザードの候補生成。

紙面の性格 → 背景 → 配置 → 配色 → タイトル色 の 5 ステップを、同じ背景の上で決定的に描く。
候補はすべて「文字まで合成した完成イメージ」で、確定時は再描画せずそのまま
保存する。選んだ見た目と完成品がずれない。
"""

from __future__ import annotations

from uuid import uuid4

from src.adapters.candidate_source.palettes import (
    Palette,
    default_palette,
    palette_candidates,
    palette_for,
)
from src.adapters.candidate_source.templates import (
    TEMPLATE_DESCRIPTIONS,
    TEMPLATE_LABELS,
)
from src.adapters.candidate_source.title_colors import title_color_candidates
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
from src.domain.semantic_theme import theme_look
from src.ports.ai_generation_quota_port import AiGenerationQuotaPort
from src.ports.candidate_source_port import CandidateSourcePort
from src.ports.candidate_store_port import CandidateStorePort
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
        store: CandidateStorePort,
        uploads: ImageUploadPort,
        ai_quota: AiGenerationQuotaPort,
    ) -> None:
        self._prompt_engine = prompt_engine
        self._source = source
        self._renderer = renderer
        self._store = store
        self._uploads = uploads
        self._ai_quota = ai_quota

    async def suggest_types(
        self,
        request: FlyerGenerationRequest,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 1。3 種の紙面の性格を、同じ地・同じ差し色で描く。

        3 枚で地を共有するのは、色の差ではなく書体と寄せの差だけを見せるため。
        おすすめはテーマに合う 1 枚だけに付け、並び順は動かさない。
        """
        context = await self._prompt_engine.generate_prompt_context(request)
        background = await self._source.preview_background(request.semantic_theme)
        recommended = theme_look(request.semantic_theme).recommended
        items: list[CandidateItem] = []
        for template_id in TemplateId:
            palette = default_palette(template_id, request.semantic_theme)
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
                    recommended=template_id is recommended,
                )
            )
        return CandidateList(candidates=items)

    async def suggest_backgrounds(
        self,
        request: FlyerGenerationRequest,
        count: int,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 2。選んだ紙面の背景を描く。AI は 1 端末あたりの残り枚数まで。"""
        context = await self._prompt_engine.generate_prompt_context(request)
        palette = default_palette(request.template_id, request.semantic_theme)
        allowed = min(max(1, count), self._ai_quota.remaining(owner_token_hash))
        options = await self._source.suggest_backgrounds(request, context, allowed)
        used = sum(1 for option in options if option.source == "ai")
        if used:
            self._ai_quota.consume(owner_token_hash, used)
        # AI を設定しているのに 1 枚も作れなかったときは、代替背景へ落ちている。
        # 画面が「上限」か「失敗」かを出せるよう、理由ではなく事実だけを返す。
        ai_fallback = self._source.source_id == "ai" and used == 0
        remaining = self._ai_quota.remaining(owner_token_hash)
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
                source=option.source,
            ).model_copy(update={"ai_remaining": remaining})
            for option in options
        ]
        return CandidateList(candidates=items, ai_fallback=ai_fallback)

    async def create_uploaded_background(
        self,
        request: FlyerGenerationRequest,
        payload: bytes,
        owner_token_hash: str | None = None,
    ) -> CandidateItem:
        """ステップ 2。持ち込まれた写真を 1 枚の背景候補にする。

        形式検証・EXIF 除去・A4 縦（1080×1528）の中央クロップは `ImageUploadPort` が行う。
        候補を作るだけなので、生成回数は消費しない。
        """
        background = self._uploads.normalize(payload)
        palette = default_palette(request.template_id, request.semantic_theme)
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
            description="中央をA4縦で切り抜いた背景",
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
        palette = palette_for(
            meta.palette_id,
            meta.template_id,
            meta.request.semantic_theme,
        )
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
                source=meta.source,
            )
            for layout in TextLayout
        ]
        return CandidateList(candidates=items)

    def suggest_palettes(
        self,
        parent_id: str,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 4。選んだ配置のまま 4 通りの配色を描く。

        いまの色を先頭に置く。並びが変わると、ステップ 3 で見た色と確定後の色が
        食い違う。テーマを選んでいれば、テーマの差し色から 4 通りを作る。
        """
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
                source=meta.source,
            )
            for palette in palette_candidates(
                meta.template_id,
                meta.request.semantic_theme,
                meta.palette_id,
            )
        ]
        return CandidateList(candidates=items)

    def suggest_title_colors(
        self,
        parent_id: str,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 5。選んだ配色のまま 4 通りのタイトル色を描く。

        先頭は「自動」。背景の明るさから墨か白を選ぶので、迷ったらここへ戻せる。
        """
        meta = self._load_owned_meta(parent_id, owner_token_hash)
        background = self._store.load_background(parent_id)
        palette = palette_for(
            meta.palette_id,
            meta.template_id,
            meta.request.semantic_theme,
        )
        items = [
            self._make(
                kind=CandidateKind.TITLE_COLOR,
                request=meta.request.model_copy(
                    update={"title_color": option.color}
                ),
                context=meta.context,
                background=background,
                palette=palette,
                layout=meta.layout_id,
                parent_id=parent_id,
                label=option.label,
                description=option.description,
                owner_token_hash=meta.owner_token_hash,
                source=meta.source,
                title_color_id=option.title_color_id,
            )
            for option in title_color_candidates(
                meta.request.semantic_theme,
                meta.template_id,
                meta.context.suggested_accent_color,
            )
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
        recommended: bool = False,
        title_color_id: str | None = None,
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
            title_color_id=title_color_id,
            parent_id=parent_id,
            label=label,
            description=description,
            source=source or "placeholder",
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
            title_color=request.title_color,
            source=source or "placeholder",
            recommended=recommended,
        )


__all__ = ["ProposeCandidatesUseCase", "context_with_palette"]
