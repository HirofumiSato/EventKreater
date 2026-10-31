"""OpenAI の画像生成で背景候補を作る。

予算（1 回の生成あたりの原価）を超える場合は生成せず、呼び出し元の代替供給元へ
委譲する。失敗しても候補が 0 枚にならないよう、必ず 1 枚以上を返す。
"""

from __future__ import annotations

import logging

from src.adapters.image_generator.dalle_image_generator import (
    resolved_image_quality,
    resolved_image_size,
)
from src.domain.layout_prompts import prompt_with_layout_hint
from src.domain.models import FlyerGenerationRequest, LLMGenerationContext
from src.domain.pricing import (
    DEFAULT_IMAGE_MODEL,
    DEFAULT_IMAGE_QUALITY,
    DEFAULT_IMAGE_SIZE,
    estimate_image_cost_jpy,
)
from src.ports.candidate_source_port import BackgroundOption, CandidateSourcePort
from src.ports.image_generator_port import ImageGeneratorPort

logger = logging.getLogger(__name__)


class DalleCandidateSource(CandidateSourcePort):
    """画像生成 API で背景候補を作り、失敗時は代替供給元へ委譲する。"""

    def __init__(
        self,
        generator: ImageGeneratorPort,
        *,
        fallback: CandidateSourcePort,
        model: str = DEFAULT_IMAGE_MODEL,
        quality: str = DEFAULT_IMAGE_QUALITY,
        size: str = DEFAULT_IMAGE_SIZE,
        usd_jpy_rate: float,
        max_cost_jpy: float,
    ) -> None:
        self._generator = generator
        self._fallback = fallback
        self._model = model
        self._quality = resolved_image_quality(model, quality)
        self._size = resolved_image_size(model, size)
        self._unit_cost_jpy = estimate_image_cost_jpy(
            model,
            self._quality,
            self._size,
            usd_jpy_rate,
        )
        self._max_cost_jpy = max_cost_jpy

    @property
    def source_id(self) -> str:
        return "ai"

    async def suggest_backgrounds(
        self,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
        count: int,
    ) -> list[BackgroundOption]:
        wanted = max(0, count)
        if wanted == 0:
            return await self._fallback.suggest_backgrounds(request, context, 1)

        prompt = _prompt_with_negative_space(context, request)
        options: list[BackgroundOption] = []
        spent = 0.0
        for index in range(wanted):
            if spent + self._unit_cost_jpy > self._max_cost_jpy:
                logger.warning(
                    "AI 候補の予算上限に達したため打ち切ります: spent=%.2f unit=%.2f cap=%.2f",
                    spent,
                    self._unit_cost_jpy,
                    self._max_cost_jpy,
                )
                break
            background = await self._generator.generate_background(
                prompt,
                context.negative_prompt_en,
                "9:16",
            )
            spent += self._unit_cost_jpy
            if _generator_used_fallback(self._generator):
                logger.warning("AI 背景の生成に失敗したため代替背景へ切り替えます")
                break
            options.append(
                BackgroundOption(
                    background=background,
                    label=f"AI背景 {index + 1}" if wanted > 1 else "AIが描いた背景",
                    description="催しの内容から生成した背景",
                    source="ai",
                )
            )

        if options:
            return options
        return await self._fallback.suggest_backgrounds(request, context, 1)


def _prompt_with_negative_space(
    context: LLMGenerationContext,
    request: FlyerGenerationRequest,
) -> str:
    """背景プロンプトに、必須被写体・余白指示・切り抜き安全域を足す。

    除外語の連結は `DalleImageGenerator` が行うので、ここでは触らない。
    """
    return prompt_with_layout_hint(context, request)


def _generator_used_fallback(generator: ImageGeneratorPort) -> bool:
    return getattr(generator, "used_fallback", False) is True


__all__ = ["DalleCandidateSource"]
