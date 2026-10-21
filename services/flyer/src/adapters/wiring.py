"""API キーの有無で本番アダプターとモックを切り替える。"""

from __future__ import annotations

from src.adapters.candidate_source.placeholder_candidate_source import (
    PlaceholderCandidateSource,
)
from src.adapters.image_generator.dalle_image_generator import DalleImageGenerator
from src.adapters.image_generator.mock_image_generator import MockImageGenerator
from src.adapters.image_generator.static_fallback_image_generator import (
    StaticFallbackImageGenerator,
)
from src.adapters.prompt_engine.mock_prompt_engine import MockPromptEngine
from src.adapters.prompt_engine.openai_prompt_engine import OpenAIPromptEngine
from src.infrastructure.config import Settings
from src.ports.candidate_source_port import CandidateSourcePort
from src.ports.image_generator_port import ImageGeneratorPort
from src.ports.prompt_engine_port import PromptEnginePort


def build_candidate_source(settings: Settings) -> CandidateSourcePort:
    """候補背景の供給元。いまはローカル合成のみ。

    ネット取得や AI 生成へ差し替えるときは、ここで分岐を足す。
    """
    del settings
    return PlaceholderCandidateSource()


def build_prompt_engine(settings: Settings) -> PromptEnginePort:
    if settings.openai_api_key:
        return OpenAIPromptEngine(
            api_key=settings.openai_api_key,
            model=settings.openai_text_model,
            timeout_seconds=settings.llm_timeout_seconds,
        )
    return MockPromptEngine()


def build_image_generator(
    settings: Settings,
    fallback: StaticFallbackImageGenerator | None = None,
) -> ImageGeneratorPort:
    if not settings.openai_api_key:
        return MockImageGenerator()
    fallback = fallback or StaticFallbackImageGenerator(settings.fallback_dir)
    return DalleImageGenerator(
        api_key=settings.openai_api_key,
        fallback=fallback,
        timeout_seconds=settings.image_generation_timeout_seconds,
        max_attempts=settings.image_generation_max_attempts,
        model=settings.openai_image_model,
    )
