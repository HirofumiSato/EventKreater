"""外部アダプター。API キーが無くてもモックで完結する。"""

from __future__ import annotations

import asyncio
import os
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from PIL import Image

from src.adapters.image_generator.dalle_image_generator import (
    DalleImageGenerator,
    compose_image_prompt,
    dalle_size_for_aspect_ratio,
    download_image,
)
from src.adapters.image_generator.mock_image_generator import MockImageGenerator
from src.adapters.image_generator.static_fallback_image_generator import (
    StaticFallbackImageGenerator,
)
from src.adapters.prompt_engine.mock_prompt_engine import MockPromptEngine
from src.adapters.prompt_engine.openai_prompt_engine import (
    SYSTEM_PROMPT,
    OpenAIPromptEngine,
    OpenAIStructuredTransport,
)
from src.adapters.wiring import (
    build_candidate_source,
    build_image_generator,
    build_prompt_engine,
)
from src.adapters.candidate_source.dalle_candidate_source import DalleCandidateSource
from src.adapters.candidate_source.placeholder_candidate_source import (
    PlaceholderCandidateSource,
)
from src.domain.exceptions import ImageGenerationTimeoutError, LLMContextGenerationError
from src.domain.models import LLMGenerationContext, SemanticTheme, TemplateId
from src.domain.pricing import DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, DEFAULT_IMAGE_SIZE
from src.infrastructure.config import Settings
from tests.support import make_context, make_request


class _Message:
    def __init__(self, parsed: object, refusal: str | None = None) -> None:
        self.parsed = parsed
        self.refusal = refusal


class _Choice:
    def __init__(self, message: _Message) -> None:
        self.message = message


class _Completion:
    def __init__(self, message: _Message) -> None:
        self.choices = [_Choice(message)]


class _StubParse:
    def __init__(self, handler: object) -> None:
        self._handler = handler

    async def parse(self, **kwargs: object) -> object:
        handler = self._handler
        assert callable(handler)
        return await handler(**kwargs)


class _StubClient:
    def __init__(self, handler: object) -> None:
        self.beta = self
        self.chat = self
        self.completions = _StubParse(handler)


class _ScriptedTransport:
    def __init__(self, outcome: LLMGenerationContext | Exception) -> None:
        self.outcome = outcome
        self.messages: list[object] | None = None

    async def parse(self, messages: list[object]) -> LLMGenerationContext:
        self.messages = messages
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class _ImageClient:
    def __init__(self, behavior: object) -> None:
        self._behavior = behavior
        self.calls: list[dict[str, object]] = []

    async def generate_image(self, *, prompt: str, size: str, timeout: float) -> bytes:
        self.calls.append({"prompt": prompt, "size": size, "timeout": timeout})
        behavior = self._behavior
        assert callable(behavior)
        result = behavior(prompt, size, timeout)
        if asyncio.iscoroutine(result):
            return await result
        assert isinstance(result, bytes)
        return result


def _png(color: tuple[int, int, int] = (10, 20, 30)) -> bytes:
    image = Image.new("RGB", (8, 8), color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


#: リポジトリ直下から見た仕様書の位置。
_SPEC_RELATIVE = Path("docs") / "flyer" / "specs" / "implementation_spec.md"

#: 仕様書の置き場を明示する環境変数。開発コンテナはサービスだけを /app に置くため、
#: compose が ``/repo`` へ仕様書を写してこれを指す。
_SPEC_ROOT_ENV = "FLYER_SPEC_ROOT"


def _implementation_spec_path() -> Path | None:
    """仕様書を探す。サービス単体で置かれた開発コンテナでも見つかるようにする。

    サービスルートの祖先をすべて辿り、``docs/flyer/specs/implementation_spec.md`` を
    持つディレクトリをリポジトリルートとみなす。``FLYER_SPEC_ROOT`` があればそこを
    先に見る。
    """
    service_root = Path(__file__).resolve().parents[1]
    roots: list[Path] = []
    override = os.environ.get(_SPEC_ROOT_ENV)
    if override:
        roots.append(Path(override))
    roots.append(service_root)
    roots.extend(service_root.parents)
    for root in roots:
        candidate = root / _SPEC_RELATIVE
        if candidate.is_file():
            return candidate
    # 仕様書がサービス内にあった頃の配置。古い作業ツリーでも読めるようにする。
    legacy = service_root / "docs" / "specs" / "implementation_spec.md"
    return legacy if legacy.is_file() else None


def test_system_prompt_matches_implementation_spec() -> None:
    spec_path = _implementation_spec_path()
    if spec_path is None:
        pytest.skip(
            f"{_SPEC_RELATIVE} が見つかりません。リポジトリ全体をチェックアウトした"
            f"ツリーか、{_SPEC_ROOT_ENV} を設定した環境で実行してください。"
        )
    text = spec_path.read_text(encoding="utf-8")
    start = text.index("# Role\nYou are an elite commercial art director")
    ending = "Output MUST be strict JSON adhering to the provided schema."
    extracted = text[start : text.index(ending) + len(ending)]
    assert SYSTEM_PROMPT == extracted


def test_mock_prompt_engine_returns_valid_context() -> None:
    engine = MockPromptEngine()
    context = asyncio.run(
        engine.generate_prompt_context(make_request(template_id=TemplateId.STYLE_2_WARM_EARTH))
    )
    assert context.suggested_accent_color == "#059669"
    assert context.suggested_overlay_alpha == pytest.approx(0.45)
    assert "text" in context.negative_prompt_en


def test_mock_image_generator_returns_portrait_png() -> None:
    generator = MockImageGenerator()
    payload = asyncio.run(generator.generate_background("a saxophone", "text", "9:16"))
    image = Image.open(BytesIO(payload))
    assert image.size == (1080, 1528)
    assert payload.startswith(b"\x89PNG")


def test_blank_api_key_selects_mocks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "   ")
    settings = Settings(
        openai_api_key=None,
        storage_dir=tmp_path / "tmp",
        fallback_dir=tmp_path / "bg",
    )
    assert settings.openai_api_key is None
    assert isinstance(build_prompt_engine(settings), MockPromptEngine)
    assert isinstance(build_image_generator(settings), MockImageGenerator)


def test_blank_image_settings_fall_back_to_defaults(tmp_path: Path) -> None:
    """compose が ``${VAR:-}`` で空文字を渡しても既定で動く。"""
    settings = Settings(
        storage_dir=tmp_path / "tmp",
        fallback_dir=tmp_path / "bg",
        openai_text_model="",
        openai_image_model="",
        image_quality="",
        image_size="",
    )
    assert settings.openai_text_model == "gpt-4o-mini"
    assert settings.openai_image_model == DEFAULT_IMAGE_MODEL
    assert settings.image_quality == DEFAULT_IMAGE_QUALITY
    assert settings.image_size == DEFAULT_IMAGE_SIZE


def test_configured_api_key_selects_openai_adapters(tmp_path: Path) -> None:
    settings = Settings(
        openai_api_key="sk-test",
        storage_dir=tmp_path / "tmp",
        fallback_dir=tmp_path / "bg",
    )
    assert isinstance(build_prompt_engine(settings), OpenAIPromptEngine)
    image_generator = build_image_generator(settings)
    assert isinstance(image_generator, DalleImageGenerator)
    assert isinstance(image_generator._fallback, StaticFallbackImageGenerator)


def test_openai_prompt_engine_sends_spec_prompt_and_user_json() -> None:
    expected = make_context()
    transport = _ScriptedTransport(expected)
    engine = OpenAIPromptEngine(api_key="sk-test", transport=transport)
    result = asyncio.run(engine.generate_prompt_context(make_request()))
    assert result == expected
    assert transport.messages is not None
    assert transport.messages[0]["content"] == SYSTEM_PROMPT
    assert "ジャズの夜" in str(transport.messages[1]["content"])


def test_prompt_messages_include_theme_direction() -> None:
    transport = _ScriptedTransport(make_context())
    engine = OpenAIPromptEngine(api_key="sk-test", transport=transport)
    asyncio.run(
        engine.generate_prompt_context(make_request(semantic_theme=SemanticTheme.NEON))
    )
    assert transport.messages is not None
    content = str(transport.messages[1]["content"])
    assert "design_direction" in content
    assert "neon" in content
    # 選んだテーマそのものも、ユーザー JSON に残す。
    assert "semantic_theme" in content


def test_prompt_messages_omit_theme_direction_when_unset() -> None:
    transport = _ScriptedTransport(make_context())
    engine = OpenAIPromptEngine(api_key="sk-test", transport=transport)
    asyncio.run(engine.generate_prompt_context(make_request()))
    assert transport.messages is not None
    assert "design_direction" not in str(transport.messages[1]["content"])


def test_openai_prompt_engine_wraps_transport_errors() -> None:
    engine = OpenAIPromptEngine(
        api_key="sk-test",
        transport=_ScriptedTransport(RuntimeError("upstream")),
    )
    with pytest.raises(LLMContextGenerationError):
        asyncio.run(engine.generate_prompt_context(make_request()))


def test_structured_transport_reads_parsed_model() -> None:
    expected = make_context()

    async def handler(**kwargs: object) -> _Completion:
        assert kwargs["model"] == "gpt-4o-mini"
        assert kwargs["response_format"] is LLMGenerationContext
        messages = kwargs["messages"]
        assert isinstance(messages, list)
        assert messages[0]["content"] == SYSTEM_PROMPT
        return _Completion(_Message(expected))

    transport = OpenAIStructuredTransport(
        api_key="sk-test",
        client=_StubClient(handler),  # type: ignore[arg-type]
    )
    parsed = asyncio.run(transport.parse([{"role": "system", "content": SYSTEM_PROMPT}]))
    assert parsed == expected


def test_structured_transport_rejects_refusal_and_sdk_errors() -> None:
    async def refuse(**kwargs: object) -> _Completion:
        return _Completion(_Message(None, refusal="no"))

    transport = OpenAIStructuredTransport(
        api_key="sk-test",
        client=_StubClient(refuse),  # type: ignore[arg-type]
    )
    with pytest.raises(LLMContextGenerationError):
        asyncio.run(transport.parse([{"role": "user", "content": "{}"}]))

    async def explode(**kwargs: object) -> _Completion:
        raise RuntimeError("down")

    failing = OpenAIStructuredTransport(
        api_key="sk-test",
        client=_StubClient(explode),  # type: ignore[arg-type]
    )
    with pytest.raises(LLMContextGenerationError):
        asyncio.run(failing.parse([{"role": "user", "content": "{}"}]))


def test_compose_image_prompt_includes_negative_prompt() -> None:
    composed = compose_image_prompt("A brass saxophone on mahogany", "text, logos")
    assert "saxophone" in composed
    assert "Avoid: text, logos" in composed
    assert "Do not render any text" in composed
    assert len(compose_image_prompt("x" * 5000, "y" * 500)) <= 3900


def test_dalle_size_mapping() -> None:
    # 論理サイズは A4 縦に近い 1024x1536。dall-e-3 へは縦長 1024x1792 に寄せる。
    assert dalle_size_for_aspect_ratio("9:16") == "1024x1536"
    assert dalle_size_for_aspect_ratio("1:1") == "1024x1024"
    assert dalle_size_for_aspect_ratio("16:9") == "1536x1024"


def test_dalle_success_does_not_use_fallback(tmp_path: Path) -> None:
    payload = _png()
    client = _ImageClient(lambda prompt, size, timeout: payload)
    generator = DalleImageGenerator(
        client=client,
        fallback=StaticFallbackImageGenerator(tmp_path),
        timeout_seconds=5,
        max_attempts=2,
    )
    result = asyncio.run(generator.generate_background("prompt", "text", "1:1"))
    assert result == payload
    assert generator.used_fallback is False
    assert client.calls[0]["size"] == "1024x1024"
    assert "Avoid: text" in str(client.calls[0]["prompt"])


def test_dalle_retries_then_succeeds(tmp_path: Path) -> None:
    payload = _png((1, 2, 3))
    state = {"count": 0}

    def behavior(prompt: str, size: str, timeout: float) -> bytes:
        state["count"] += 1
        if state["count"] == 1:
            raise RuntimeError("temporary")
        return payload

    async def no_sleep(seconds: float) -> None:
        return None

    generator = DalleImageGenerator(
        client=_ImageClient(behavior),
        fallback=StaticFallbackImageGenerator(tmp_path),
        timeout_seconds=5,
        max_attempts=2,
        sleep=no_sleep,
    )
    result = asyncio.run(generator.generate_background("prompt", "text"))
    assert result == payload
    assert state["count"] == 2
    assert generator.used_fallback is False


def test_dalle_timeout_delegates_to_static_fallback(tmp_path: Path) -> None:
    async def slow(prompt: str, size: str, timeout: float) -> bytes:
        await asyncio.sleep(2)
        return _png()

    fallback = StaticFallbackImageGenerator(tmp_path)
    fallback.set_template(TemplateId.STYLE_3_VIBRANT_POP)
    generator = DalleImageGenerator(
        client=_ImageClient(slow),
        fallback=fallback,
        timeout_seconds=0.2,
        max_attempts=2,
    )
    payload = asyncio.run(generator.generate_background("prompt", "text", "9:16"))
    image = Image.open(BytesIO(payload))
    assert generator.used_fallback is True
    assert image.size == (1080, 1528)
    assert (tmp_path / "style_3_vibrant_pop_default.png").is_file()


def test_download_image_rejects_non_image() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html></html>")

    async def run() -> None:
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            await download_image("https://example.test/missing.png", 5, client=client)

    with pytest.raises(ImageGenerationTimeoutError):
        asyncio.run(run())
