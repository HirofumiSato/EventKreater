"""テスト用のリクエストとコンテキスト。"""

from __future__ import annotations

from src.domain.models import (
    FlyerGenerationRequest,
    LLMGenerationContext,
    RainPolicy,
    SemanticTheme,
    TemplateId,
    TextLayout,
)

_ACCENTS: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "#F59E0B",
    TemplateId.STYLE_2_WARM_EARTH: "#059669",
    TemplateId.STYLE_3_VIBRANT_POP: "#FBBF24",
}


def make_request(
    title: str = "ジャズの夜",
    template_id: TemplateId = TemplateId.STYLE_1_BAR_STYLISH,
    capacity: str | None = "先着15名",
    layout_id: TextLayout = TextLayout.CLASSIC,
    semantic_theme: SemanticTheme | None = None,
) -> FlyerGenerationRequest:
    return FlyerGenerationRequest(
        title=title,
        event_date="2026年11月15日(日)",
        event_time="19:00〜22:00 (開場 18:30)",
        price="3,000円 (1ドリンク付)",
        location="Jazz Bar MOON 新宿東口",
        rain_policy=RainPolicy.RAIN_OR_SHINE,
        capacity=capacity,
        semantic_theme=semantic_theme,
        template_id=template_id,
        layout_id=layout_id,
    )


def make_context(
    template_id: TemplateId = TemplateId.STYLE_1_BAR_STYLISH,
    overlay_alpha: float = 0.55,
) -> LLMGenerationContext:
    return LLMGenerationContext(
        image_prompt_en=(
            "Cinematic atmospheric background with generous negative space, "
            f"for template {template_id.value}, no lettering"
        ),
        negative_prompt_en="text, letters, words, logos, human faces close-up",
        suggested_accent_color=_ACCENTS[template_id],
        suggested_overlay_alpha=overlay_alpha,
    )
