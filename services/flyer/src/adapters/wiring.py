"""API キーと設定で本番アダプターとモックを切り替える。"""

from __future__ import annotations

from src.adapters.candidate_source.dalle_candidate_source import DalleCandidateSource
from src.adapters.candidate_source.placeholder_candidate_source import (
    PlaceholderCandidateSource,
)
from src.adapters.image_generator.dalle_image_generator import DalleImageGenerator
from src.adapters.image_generator.mock_image_generator import MockImageGenerator
from src.adapters.image_generator.static_fallback_image_generator import (
    StaticFallbackImageGenerator,
)
from src.adapters.image_upload.pillow_upload_normalizer import PillowUploadNormalizer
from src.adapters.prompt_engine.mock_prompt_engine import MockPromptEngine
from src.adapters.prompt_engine.openai_prompt_engine import OpenAIPromptEngine
from src.infrastructure.config import Settings
from src.ports.candidate_source_port import CandidateSourcePort
from src.ports.image_generator_port import ImageGeneratorPort
from src.ports.image_upload_port import ImageUploadPort
from src.ports.prompt_engine_port import PromptEnginePort


def ai_candidates_enabled(settings: Settings) -> bool:
    """AI の背景候補を使うか。鍵が無ければ設定に関わらず無効。"""
    return settings.ai_candidates_active and bool(settings.openai_api_key)


def build_candidate_source(settings: Settings) -> CandidateSourcePort:
    """候補背景の供給元。

    AI が無効ならローカル合成（グラデーション）だけを使う。有効なら画像生成 API を
    使い、失敗したときは同じローカル合成へ委譲する。
    """
    placeholder = PlaceholderCandidateSource()
    if not ai_candidates_enabled(settings):
        return placeholder
    return DalleCandidateSource(
        DalleImageGenerator(
            api_key=settings.openai_api_key,
            fallback=StaticFallbackImageGenerator(settings.fallback_dir),
            timeout_seconds=settings.image_generation_timeout_seconds,
            # 候補は 1 枚ずつ作る。リトライは原価を倍にするので 1 回に固定する。
            max_attempts=1,
            model=settings.openai_image_model,
            quality=settings.image_quality,
            size=settings.image_size,
        ),
        fallback=placeholder,
        model=settings.openai_image_model,
        quality=settings.image_quality,
        size=settings.image_size,
        usd_jpy_rate=settings.usd_jpy_rate,
        max_cost_jpy=settings.max_cost_jpy_per_request,
    )


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
        quality=settings.image_quality,
        size=settings.image_size,
    )


def build_image_upload(settings: Settings) -> ImageUploadPort:
    """利用者の写真を背景用の PNG に揃える。"""
    return PillowUploadNormalizer(
        max_bytes=settings.upload_max_bytes,
        max_pixels=settings.upload_max_pixels,
    )
