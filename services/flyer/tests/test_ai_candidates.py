"""AI 背景候補の供給元と、原価・回数の上限。外部 API は呼ばない。"""

from __future__ import annotations

import asyncio
import base64
from io import BytesIO
from pathlib import Path

import pytest
from openai.types import ImagesResponse
from openai.types.image import Image as OpenAIImage
from PIL import Image

from src.adapters.candidate_source.dalle_candidate_source import DalleCandidateSource
from src.adapters.candidate_source.placeholder_candidate_source import (
    PlaceholderCandidateSource,
)
from src.adapters.image_generator.dalle_image_generator import (
    OpenAIDalleClient,
    resolved_image_quality,
    resolved_image_size,
    uses_gpt_image_vocabulary,
)
from src.adapters.wiring import build_candidate_source
from src.domain.models import TemplateId
from src.domain.pricing import (
    DEFAULT_IMAGE_MODEL,
    DEFAULT_IMAGE_QUALITY,
    DEFAULT_IMAGE_SIZE,
    DEFAULT_MAX_COST_JPY_PER_REQUEST,
    STRESS_USD_JPY_RATE,
    estimate_image_cost_jpy,
    estimate_wizard_cost_jpy,
)
from src.infrastructure.config import Settings
from src.infrastructure.quota.memory_ai_quota import MemoryAiGenerationQuota
from src.ports.image_generator_port import ImageGeneratorPort
from tests.support import make_context, make_request


def _png(color: tuple[int, int, int] = (10, 20, 30)) -> bytes:
    image = Image.new("RGB", (8, 8), color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class _FakeGenerator(ImageGeneratorPort):
    """呼ばれた回数とプロンプトを覚えるだけの生成器。"""

    def __init__(self, *, fail: bool = False) -> None:
        self.calls: list[dict[str, str]] = []
        self.used_fallback = False
        self._fail = fail

    async def generate_background(
        self,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str = "9:16",
    ) -> bytes:
        self.calls.append(
            {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "aspect_ratio": aspect_ratio,
            }
        )
        self.used_fallback = self._fail
        return _png((len(self.calls), 1, 2))


def _source(
    generator: ImageGeneratorPort,
    *,
    max_cost_jpy: float = DEFAULT_MAX_COST_JPY_PER_REQUEST,
) -> DalleCandidateSource:
    return DalleCandidateSource(
        generator,
        fallback=PlaceholderCandidateSource(),
        model=DEFAULT_IMAGE_MODEL,
        quality=DEFAULT_IMAGE_QUALITY,
        size=DEFAULT_IMAGE_SIZE,
        usd_jpy_rate=STRESS_USD_JPY_RATE,
        max_cost_jpy=max_cost_jpy,
    )


def test_ai_source_marks_candidate_as_ai() -> None:
    generator = _FakeGenerator()
    source = _source(generator)

    options = asyncio.run(
        source.suggest_backgrounds(make_request(), make_context(), 1)
    )

    assert len(options) == 1
    assert options[0].source == "ai"
    assert source.source_id == "ai"
    assert len(generator.calls) == 1
    # 文字を載せる余白の指示と、A4 への切り抜きで上下が落ちる前提が入る。
    assert "uncluttered" in generator.calls[0]["prompt"]
    assert "central 85% of the frame" in generator.calls[0]["prompt"]
    # 除外語は画像生成アダプターが連結するので、ここでは渡すだけ。
    assert generator.calls[0]["negative_prompt"] == make_context().negative_prompt_en
    assert generator.calls[0]["aspect_ratio"] == "9:16"


def test_ai_source_falls_back_when_generation_fails() -> None:
    source = _source(_FakeGenerator(fail=True))

    options = asyncio.run(
        source.suggest_backgrounds(make_request(), make_context(), 1)
    )

    assert len(options) == 1
    assert options[0].source == "placeholder"


def test_ai_source_stops_at_the_budget() -> None:
    generator = _FakeGenerator()
    # 1 枚 3.2 円。上限 9.5 円では 3 枚目に入る前に打ち切る。
    source = _source(generator, max_cost_jpy=9.5)

    options = asyncio.run(
        source.suggest_backgrounds(make_request(), make_context(), 3)
    )

    assert len(options) == 2
    assert len(generator.calls) == 2
    assert all(option.source == "ai" for option in options)


def test_ai_source_never_returns_zero_candidates() -> None:
    source = _source(_FakeGenerator(), max_cost_jpy=0.0)

    options = asyncio.run(
        source.suggest_backgrounds(make_request(), make_context(), 1)
    )

    assert len(options) == 1
    assert options[0].source == "placeholder"


def test_ai_source_preview_is_free() -> None:
    generator = _FakeGenerator()
    source = _source(generator)

    payload = asyncio.run(source.preview_background(TemplateId.STYLE_2_WARM_EARTH))

    assert payload.startswith(b"\x89PNG")
    assert generator.calls == []


def test_llm_cost_matches_the_budget_calculation() -> None:
    # 3 枚 + LLM 4 回でも 10 円未満。
    assert estimate_image_cost_jpy(
        DEFAULT_IMAGE_MODEL,
        DEFAULT_IMAGE_QUALITY,
        DEFAULT_IMAGE_SIZE,
        STRESS_USD_JPY_RATE,
    ) == pytest.approx(3.2)
    wizard = estimate_wizard_cost_jpy(
        3,
        model=DEFAULT_IMAGE_MODEL,
        quality=DEFAULT_IMAGE_QUALITY,
        size=DEFAULT_IMAGE_SIZE,
        usd_jpy_rate=STRESS_USD_JPY_RATE,
        llm_calls=4,
    )
    assert wizard < 10.0
    assert estimate_wizard_cost_jpy(3, usd_jpy_rate=150.0) < wizard


def test_memory_quota_counts_down_and_expires() -> None:
    now = {"value": 0.0}
    quota = MemoryAiGenerationQuota(3, 3600, clock=lambda: now["value"])

    assert quota.remaining("owner") == 3
    quota.consume("owner", 2)
    assert quota.remaining("owner") == 1
    # 別の端末は影響を受けない。
    assert quota.remaining("other") == 3
    # 窓を過ぎれば戻る。
    now["value"] = 3601.0
    assert quota.remaining("owner") == 3


def test_memory_quota_treats_missing_owner_as_one_bucket() -> None:
    quota = MemoryAiGenerationQuota(1, 3600, clock=lambda: 0.0)
    quota.consume(None, 1)
    assert quota.remaining(None) == 0
    assert quota.remaining("") == 0
    assert quota.remaining("owner") == 1


def test_wiring_uses_ai_source_only_with_key_and_flag(tmp_path: Path) -> None:
    base = {
        "storage_dir": tmp_path / "tmp",
        "fallback_dir": tmp_path / "bg",
    }
    no_key = Settings(openai_api_key=None, **base)  # type: ignore[arg-type]
    assert isinstance(build_candidate_source(no_key), PlaceholderCandidateSource)

    forced_off = Settings(
        openai_api_key="sk-test",
        ai_candidates_enabled=False,
        **base,  # type: ignore[arg-type]
    )
    assert isinstance(build_candidate_source(forced_off), PlaceholderCandidateSource)

    enabled = Settings(openai_api_key="sk-test", **base)  # type: ignore[arg-type]
    assert isinstance(build_candidate_source(enabled), DalleCandidateSource)

    forced_on_without_key = Settings(
        openai_api_key=None,
        ai_candidates_enabled=True,
        **base,  # type: ignore[arg-type]
    )
    assert isinstance(
        build_candidate_source(forced_on_without_key),
        PlaceholderCandidateSource,
    )


class _StubImages:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def generate(self, **kwargs: object) -> ImagesResponse:
        self.calls.append(kwargs)
        encoded = base64.b64encode(_png()).decode("ascii")
        return ImagesResponse(created=0, data=[OpenAIImage(b64_json=encoded)])


class _StubOpenAI:
    def __init__(self) -> None:
        self.images = _StubImages()


def _generate(model: str, quality: str) -> tuple[_StubOpenAI, bytes]:
    stub = _StubOpenAI()
    client = OpenAIDalleClient(
        "sk-test",
        model=model,
        quality=quality,
        client=stub,  # type: ignore[arg-type]
    )
    payload = asyncio.run(
        client.generate_image(prompt="a scene", size="1024x1536", timeout=5.0)
    )
    return stub, payload


def test_gpt_image_request_omits_response_format() -> None:
    stub, payload = _generate("gpt-image-1", "low")

    call = stub.images.calls[0]
    assert call["size"] == "1024x1536"
    assert call["quality"] == "low"
    assert "response_format" not in call
    assert payload.startswith(b"\x89PNG")


def test_dalle_request_keeps_response_format_and_dalle_sizes() -> None:
    stub, _ = _generate("dall-e-3", "hd")

    call = stub.images.calls[0]
    # dall-e-3 に 1024x1536 は無いので、最も近い縦長へ寄せる。
    assert call["size"] == "1024x1792"
    assert call["quality"] == "hd"
    assert call["response_format"] == "url"


def test_size_and_quality_are_normalized_per_model() -> None:
    assert uses_gpt_image_vocabulary("gpt-image-1") is True
    assert uses_gpt_image_vocabulary("dall-e-3") is False
    assert resolved_image_size("gpt-image-1", "1024x1536") == "1024x1536"
    assert resolved_image_size("dall-e-3", "1024x1536") == "1024x1792"
    assert resolved_image_quality("gpt-image-1", "standard") == "low"
    assert resolved_image_quality("gpt-image-1", "hd") == "high"
    assert resolved_image_quality("dall-e-3", "low") == "standard"
    assert resolved_image_quality("dall-e-3", "high") == "hd"
