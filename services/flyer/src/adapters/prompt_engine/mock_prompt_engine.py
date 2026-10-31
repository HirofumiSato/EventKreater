"""API を消費しない固定のプロンプトコンテキスト。"""

from __future__ import annotations

from src.domain.models import FlyerGenerationRequest, LLMGenerationContext, TemplateId
from src.domain.visual_hints import PeoplePolicy, PEOPLE_CONSTRAINTS, scene_brief
from src.ports.prompt_engine_port import PromptEnginePort

_ACCENTS: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "#F59E0B",
    TemplateId.STYLE_2_WARM_EARTH: "#059669",
    TemplateId.STYLE_3_VIBRANT_POP: "#FBBF24",
}

_ALPHAS: dict[TemplateId, float] = {
    TemplateId.STYLE_1_BAR_STYLISH: 0.55,
    TemplateId.STYLE_2_WARM_EARTH: 0.45,
    TemplateId.STYLE_3_VIBRANT_POP: 0.50,
}


class MockPromptEngine(PromptEnginePort):
    """開発・テスト用。テンプレートに応じた固定の構造化コンテキストを返す。"""

    async def generate_prompt_context(
        self,
        request: FlyerGenerationRequest,
    ) -> LLMGenerationContext:
        hints = scene_brief(request)
        subject = "; ".join(hints.subjects) if hints.subjects else "the event's own subject"
        people = ""
        if hints.people is not None:
            people = f", {PEOPLE_CONSTRAINTS[hints.people]}"
            if hints.people is PeoplePolicy.ABSENT:
                people = f". {PEOPLE_CONSTRAINTS[hints.people]}"
        return LLMGenerationContext(
            image_prompt_en=(
                f"Cinematic background showing {subject}{people}, with clear negative space "
                "reserved for a text overlay, "
                f"mood aligned to {request.template_id.paper_character}, no lettering, no logos"
            ),
            negative_prompt_en=(
                "text, letters, words, logos, watermark, signature"
            ),
            suggested_accent_color=_ACCENTS[request.template_id],
            suggested_overlay_alpha=_ALPHAS[request.template_id],
        )
