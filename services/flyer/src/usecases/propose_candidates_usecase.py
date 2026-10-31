"""ウィザードの候補生成。

背景 → 紙面の性格 の 2 ステップを、同じ背景の上で決定的に描く。候補はすべて
「文字まで合成した完成イメージ」で、確定時は再描画せずそのまま保存する。
選んだ見た目と完成品がずれない。

配置・配色・題名色は選ばせない。配置を選ばせると生成時の構図（題は上、明細は下）
と食い違い、題名色を選ばせると可読性の判断を利用者へ押し付けることになる。
どれも描画側が決める。
"""

from __future__ import annotations

from uuid import uuid4

from src.adapters.candidate_source.palettes import Palette, default_palette
from src.adapters.candidate_source.templates import (
    TEMPLATE_DESCRIPTIONS,
    TEMPLATE_LABELS,
)
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
    """2 ステップ分のタイルを組み立てる。"""

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

    def suggest_types(
        self,
        parent_id: str,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 2。選んだ背景の上で、3 種の紙面の性格を焼き直す。

        背景は同じバイト列を使う。3 枚で地を共有するのは、色の差ではなく書体と
        寄せの差だけを見せるため。おすすめはテーマに合う 1 枚だけに付け、並び順は
        動かさない。LLM も画像生成も呼ばない（`meta.context` を使い回す）。
        """
        meta = self._load_owned_meta(parent_id, owner_token_hash)
        background = self._store.load_background(parent_id)
        recommendation = theme_look(meta.request.semantic_theme).recommended
        items: list[CandidateItem] = []
        for template_id in TemplateId:
            palette = default_palette(template_id, meta.request.semantic_theme)
            items.append(
                self._make(
                    kind=CandidateKind.TYPE,
                    request=meta.request.model_copy(
                        update={
                            "template_id": template_id,
                            "layout_id": TextLayout.CLASSIC,
                        }
                    ),
                    context=context_with_palette(meta.context, palette),
                    background=background,
                    palette=palette,
                    layout=TextLayout.CLASSIC,
                    parent_id=parent_id,
                    label=TEMPLATE_LABELS[template_id],
                    description=TEMPLATE_DESCRIPTIONS[template_id],
                    owner_token_hash=meta.owner_token_hash,
                    source=meta.source,
                    recommended=template_id is recommendation,
                )
            )
        return CandidateList(candidates=items)

    async def suggest_backgrounds(
        self,
        request: FlyerGenerationRequest,
        count: int,
        owner_token_hash: str | None = None,
    ) -> CandidateList:
        """ステップ 1。背景を描く。AI は 1 端末あたりの残り枚数まで。

        配置は標準に固定する。生成の構図（題は上、明細は下）と描画の積みを
        そろえるため、画面から `layout_id` を受け取っても使わない。
        """
        normalized = request.model_copy(update={"layout_id": TextLayout.CLASSIC})
        context = await self._prompt_engine.generate_prompt_context(normalized)
        palette = default_palette(normalized.template_id, normalized.semantic_theme)
        allowed = min(max(1, count), self._ai_quota.remaining(owner_token_hash))
        options = await self._source.suggest_backgrounds(normalized, context, allowed)
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
                request=normalized,
                context=context_with_palette(context, palette),
                background=option.background,
                palette=palette,
                layout=TextLayout.CLASSIC,
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
        """ステップ 1。持ち込まれた写真を 1 枚の背景候補にする。

        形式検証・EXIF 除去・A4 縦（1080×1528）の中央クロップは `ImageUploadPort` が行う。
        候補を作るだけなので、生成回数は消費しない。
        """
        background = self._uploads.normalize(payload)
        normalized = request.model_copy(update={"layout_id": TextLayout.CLASSIC})
        palette = default_palette(normalized.template_id, normalized.semantic_theme)
        context = await self._prompt_engine.generate_prompt_context(normalized)
        return self._make(
            kind=CandidateKind.BACKGROUND,
            request=normalized,
            context=context_with_palette(context, palette),
            background=background,
            palette=palette,
            layout=TextLayout.CLASSIC,
            parent_id=None,
            label="自分の写真",
            description="中央をA4縦で切り抜いた背景",
            owner_token_hash=owner_token_hash,
            source="upload",
        )

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
