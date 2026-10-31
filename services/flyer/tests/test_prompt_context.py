"""画像プロンプトへ渡すコンテクストの契約を固定する。

画面項目 → LLM の user JSON → 画像生成プロンプト、の 3 段で「何が渡り、何が
落ちるか」を検査する。外部 API は呼ばない。
"""

from __future__ import annotations

import asyncio
import json
from io import BytesIO
from typing import Any, cast

from PIL import Image
from openai.types.chat import ChatCompletionMessageParam

from src.adapters.image_generator.dalle_image_generator import (
    DalleImageGenerator,
    resolve_image_size,
)
from src.adapters.prompt_engine.openai_prompt_engine import (
    SYSTEM_PROMPT,
    OpenAIPromptEngine,
)
from src.domain.layout_prompts import (
    CALM_TITLE_BAND_HINT,
    CROP_SAFE_AREA_HINT,
    NEGATIVE_SPACE_HINT,
)
from src.domain.models import (
    FlyerGenerationRequest,
    LLMGenerationContext,
    RainPolicy,
    SemanticTheme,
    TemplateId,
    TextLayout,
)
from src.domain.prompt_payload import (
    GENERATION_PURPOSE,
    build_prompt_payload,
)
from src.usecases.generate_flyer_usecase import GenerateFlyerUseCase
from tests.support import make_context, make_request


def _png() -> bytes:
    image = Image.new("RGB", (8, 8), (10, 20, 30))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class _ScriptedTransport:
    """OpenAI へ出さず、送ったメッセージだけを控える。"""

    def __init__(self, payload: LLMGenerationContext) -> None:
        self._payload = payload
        self.messages: list[dict[str, str]] | None = None

    async def parse(self, messages: list[ChatCompletionMessageParam]) -> LLMGenerationContext:
        self.messages = cast("list[dict[str, str]]", messages)
        return self._payload


class _StubPromptEngine:
    async def generate_prompt_context(
        self,
        request: FlyerGenerationRequest,
    ) -> LLMGenerationContext:
        return make_context(request.template_id)


class _RecordingImages:
    """画像生成の呼び出しを控えるだけの生成器。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []
        self.used_fallback = False

    async def generate_background(
        self,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str = "9:16",
    ) -> bytes:
        self.calls.append({"prompt": prompt, "negative_prompt": negative_prompt})
        return _png()


class _PassthroughRenderer:
    def render_flyer(
        self,
        background_bytes: bytes,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
    ) -> bytes:
        return background_bytes


class _MemoryStorage:
    def save_temporary(self, file_id: str, image_bytes: bytes) -> str:
        return f"/api/v1/flyers/tmp/{file_id}.png"

    def load(self, file_id: str) -> bytes:
        raise FileNotFoundError(file_id)

    def cleanup_expired(self, ttl_seconds: int) -> int:
        return 0


def _image_client(calls: list[dict[str, str]]) -> Any:
    class _Client:
        async def generate_image(self, *, prompt: str, size: str, timeout: float) -> bytes:
            calls.append({"prompt": prompt, "size": size})
            return _png()

    return _Client()


def test_payload_keeps_generation_fields_and_drops_operational_ones() -> None:
    request = make_request(semantic_theme=SemanticTheme.NEON).model_copy(
        update={"target_generation": "20代から40代の音楽好き"}
    )
    payload = build_prompt_payload(request)

    assert payload["generation_purpose"] == GENERATION_PURPOSE
    assert payload["target_generation"] == "20代から40代の音楽好き"
    assert payload["design_direction"] == SemanticTheme.NEON.design_direction
    # 配置は画面が選ばない。構図は composition_hint だけで決める。
    assert "layout_id" not in payload
    # 題の型は、題そのものより先に英語の制約として載る。
    assert payload["activity_families"] == ["music_performance"]
    assert payload["setting_family"] == "bar_or_club"
    assert payload["people_policy"] == "atmosphere"
    assert payload["lighting_family"] == "night_performance"
    # 紙面の ID ではなく性格の表示名を渡し、風景の指定と読ませない。
    assert payload["paper_character"] == "静けさ"
    # 何枚作るかは絵柄に影響しないので渡さない。
    assert "count" not in payload


def test_payload_carries_energy_family_only_when_people_are_present() -> None:
    # 人が居る催しだけ、盛り上がりの型を LLM へ渡す。
    lively = build_prompt_payload(make_request(title="DJナイト Vol.7"))
    quiet = build_prompt_payload(
        make_request(title="秋の芋煮会", location="川辺 世田谷区")
    )

    assert lively["energy_family"] == "crowd_peak"
    assert "energy_family" not in quiet


def test_payload_drops_empty_fields() -> None:
    payload = build_prompt_payload(make_request(capacity=None))

    assert "capacity" not in payload
    assert "target_generation" not in payload
    assert "semantic_theme" not in payload
    assert "design_direction" not in payload


def test_payload_includes_composition_hint_only_when_given() -> None:
    assert "composition_hint" not in build_prompt_payload(make_request())
    hinted = build_prompt_payload(make_request(), composition_hint="  keep the lower third calm  ")
    assert hinted["composition_hint"] == "keep the lower third calm"


def test_user_message_uses_whitelist_and_carries_intent() -> None:
    transport = _ScriptedTransport(make_context())
    engine = OpenAIPromptEngine(api_key="sk-test", transport=transport)
    asyncio.run(engine.generate_prompt_context(make_request(title="タコパの夜")))

    assert transport.messages is not None
    assert transport.messages[0]["content"] == SYSTEM_PROMPT
    assert "Deliverable" in SYSTEM_PROMPT
    assert "How to read the event data" in SYSTEM_PROMPT

    payload = json.loads(transport.messages[1]["content"])
    assert payload["generation_purpose"] == GENERATION_PURPOSE
    assert payload["title"] == "タコパの夜"
    assert payload["activity_families"] == ["food"]
    assert payload["people_policy"] == "absent"
    # 構図は標準（題は上、明細は下）の 1 通り。紙面の性格では変えない。
    assert payload["composition_hint"] == (
        f"{NEGATIVE_SPACE_HINT}\n{CALM_TITLE_BAND_HINT}\n{CROP_SAFE_AREA_HINT}"
    )
    assert "count" not in payload


def test_direct_generation_prompt_carries_composition_and_crop_hints() -> None:
    images = _RecordingImages()
    usecase = GenerateFlyerUseCase(
        prompt_engine=_StubPromptEngine(),
        image_generator=images,
        renderer=_PassthroughRenderer(),
        storage=_MemoryStorage(),
        fallback_images=_RecordingImages(),
    )
    asyncio.run(usecase.execute(make_request(layout_id=TextLayout.BOTTOM_STACK)))

    prompt = images.calls[0]["prompt"]
    # 候補を経ない `/api/v1/flyers/generate` でも、画像直前で指示が付く。
    assert prompt.startswith("Must clearly depict")
    assert "live music being performed" in prompt
    assert NEGATIVE_SPACE_HINT in prompt
    assert CALM_TITLE_BAND_HINT in prompt
    assert "central 85% of the frame" in prompt
    assert CROP_SAFE_AREA_HINT in prompt


def test_direct_generation_prompt_carries_lively_scene() -> None:
    images = _RecordingImages()
    usecase = GenerateFlyerUseCase(
        prompt_engine=_StubPromptEngine(),
        image_generator=images,
        renderer=_PassthroughRenderer(),
        storage=_MemoryStorage(),
        fallback_images=_RecordingImages(),
    )
    asyncio.run(
        usecase.execute(make_request(title="誕生日会", location="公民館 世田谷区"))
    )

    prompt = images.calls[0]["prompt"]
    # LLM が活気に触れずに返してきても、画像の直前に盛り上がりの型が付く。
    assert prompt.startswith("Must clearly depict")
    assert "cake" in prompt
    assert "applause" in prompt


def test_target_generation_accepts_fifty_characters() -> None:
    value = "あ" * 50
    request = FlyerGenerationRequest(
        title="ジャズの夜",
        event_date="2026年11月15日(日)",
        event_time="19:00〜22:00",
        price="3,000円",
        location="Jazz Bar MOON 新宿東口",
        rain_policy=RainPolicy.RAIN_OR_SHINE,
        target_generation=value,
        template_id=TemplateId.STYLE_1_BAR_STYLISH,
    )
    assert request.target_generation == value


def test_resolve_image_size_prefers_settings_for_portrait() -> None:
    # 縦長の生成は設定値に従い、実際のリクエストと原価見積りを一致させる。
    assert resolve_image_size("9:16", "1024x1024") == "1024x1024"
    assert resolve_image_size("9:16") == "1024x1536"
    # 正方形・横長は明示指定を優先する。
    assert resolve_image_size("1:1", "1024x1536") == "1024x1024"
    assert resolve_image_size("16:9", "1024x1536") == "1536x1024"


def test_dalle_generator_requests_configured_size() -> None:
    calls: list[dict[str, str]] = []
    generator = DalleImageGenerator(
        client=_image_client(calls),
        size="1024x1024",
        max_attempts=1,
    )
    asyncio.run(generator.generate_background("a scene", "text", "9:16"))

    assert calls[0]["size"] == "1024x1024"
