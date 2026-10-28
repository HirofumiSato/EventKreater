"""OpenAI gpt-4o-mini の Structured Outputs で視覚コンテキストを作る。"""

from __future__ import annotations

import json
from typing import Protocol

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from src.domain.exceptions import LLMContextGenerationError
from src.domain.layout_prompts import composition_hint
from src.domain.models import FlyerGenerationRequest, LLMGenerationContext
from src.domain.prompt_payload import build_prompt_payload
from src.ports.prompt_engine_port import PromptEnginePort

#: 実装仕様書 2.2 のシステムプロンプト。利用者入力はここへ連結しない。
#:
#: `# Deliverable` は「何のための画像か」を固定する節。画像モデルは "poster" という
#: 語を見ると文字を描きたがるため、成果物を「文字の無い背景」と言い切り、さらに
#: 実際の生成が 2:3 で A4 へ中央切り抜きされる事実まで書く。ここが抜けると、
#: 被写体が上下端に寄って切り落とされる。
SYSTEM_PROMPT: str = (
    "# Role\n"
    "You are an elite commercial art director specializing in Japanese event flyer design.\n"
    "\n"
    "# Goal\n"
    "Analyze the user's event data and target aesthetic, then output a structured design direction:\n"
    "1. An English prompt for generating a high-end background visual.\n"
    "2. Safe negative prompts that keep image models from rendering any lettering, including Japanese characters and kanji.\n"
    "3. Color styling parameters compatible with readability.\n"
    "\n"
    "# Deliverable\n"
    "One text-free background for a Japanese event flyer that is delivered to prospective participants by URL.\n"
    "Framing: draw a 2:3 portrait image. It is then center-cropped to A4 portrait (1080x1528), so the top and bottom edges are lost. Keep the subject and every focal point inside the central 85% of the frame.\n"
    "Every Japanese character is drawn later by a deterministic renderer; you design only the ground it sits on.\n"
    "This is a flyer backdrop, not a poster: no typography, no layout mockups.\n"
    "\n"
    "# How to read the event data\n"
    "- title: the event's identity. Translate its emotional core into one concrete subject.\n"
    "- event_date, event_time: infer season and time of day (19:00 -> night, 11月 -> autumn).\n"
    "- location: infer venue type (bar, studio, hall, park) and indoor/outdoor cues.\n"
    "- rain_policy: 屋内開催 -> indoor only; 雨天決行 -> outdoor is allowed.\n"
    "- price, capacity: infer scale and tier (intimate vs large, premium vs casual). Never render them.\n"
    "- target_generation: match the audience's generation in styling, wardrobe, and energy.\n"
    "- semantic_theme and design_direction: control palette and mood.\n"
    "- template_id: apply the composition rule for that template.\n"
    "- layout_id: keep the band where the text sits calm and low-frequency.\n"
    "\n"
    "# Critical Constraints on image_prompt_en\n"
    "1. ABSOLUTE FORBIDDEN: Do NOT include any instructions that ask the image model to write text, letters, titles, dates, numbers, or calligraphy. \n"
    "2. COMPOSITION RULE: The image MUST have clear \"negative space\" (copyspace) specifically planned for text overlays:\n"
    "   - For 'style_1_bar_stylish': The center and lower-third must be dark, atmospheric, out of focus, or uncluttered.\n"
    "   - For 'style_2_warm_earth': Clean, soft, shallow depth of field, natural background with smooth textures.\n"
    "   - For 'style_3_vibrant_pop': Dynamic composition with a central or bottom low-frequency area to hold text legible.\n"
    "3. SUBJECT TRANSLATION: Do not just copy Japanese terms. Translate the emotional core of the event into visual elements (e.g., \"A jazz session at a bar\" -> \"Cinematic close-up of a vintage brass saxophone resting on a polished mahogany counter, soft amber neon bokeh, atmospheric dust motes, dimly lit, 35mm photograph, moody, elegant\").\n"
    "4. DO NOT use the words poster, flyer, banner, headline, typography, logo, or menu in image_prompt_en; they bias the image model toward drawing type.\n"
    "5. Do not place the subject or a strong focal point within 8% of the top or bottom edge; that area is cropped away.\n"
    "\n"
    "# Output Format\n"
    "Output MUST be strict JSON adhering to the provided schema."
)


def build_prompt_messages(
    request: FlyerGenerationRequest,
) -> list[ChatCompletionMessageParam]:
    """システムプロンプトと、隔離されたユーザー JSON を組み立てる。

    渡す項目は `build_prompt_payload` のホワイトリストで決める。`count` のような
    操作パラメータや、未入力の項目はユーザー JSON に載せない。
    システムプロンプトは変えない（仕様書との一致を保つ）。利用者入力はここへ連結しない。
    """
    system_message: ChatCompletionMessageParam = {
        "role": "system",
        "content": SYSTEM_PROMPT,
    }
    payload = build_prompt_payload(
        request,
        composition_hint=composition_hint(request.layout_id),
    )
    user_message: ChatCompletionMessageParam = {
        "role": "user",
        "content": json.dumps(payload, ensure_ascii=False),
    }
    return [system_message, user_message]


def context_from_completion(completion: object) -> LLMGenerationContext:
    """Structured Outputs の応答からコンテキストを取り出す。"""
    choices = getattr(completion, "choices", None)
    if not choices:
        raise LLMContextGenerationError("LLM応答が空です")
    message = choices[0].message
    refusal = getattr(message, "refusal", None)
    if isinstance(refusal, str) and refusal.strip():
        raise LLMContextGenerationError("LLMが応答を拒否しました")
    parsed = getattr(message, "parsed", None)
    if isinstance(parsed, LLMGenerationContext):
        return parsed
    if isinstance(parsed, dict):
        return LLMGenerationContext.model_validate(parsed)
    raise LLMContextGenerationError("LLM応答のスキーマが不正です")


class PromptTransport(Protocol):
    """構造化出力の取得口。テストはこれを差し替える。"""

    async def parse(
        self,
        messages: list[ChatCompletionMessageParam],
    ) -> LLMGenerationContext:
        """メッセージ列から視覚コンテキストを得る。"""
        ...


class OpenAIStructuredTransport:
    """`beta.chat.completions.parse` を呼ぶ本番トランスポート。"""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "gpt-4o-mini",
        timeout_seconds: float = 20.0,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self._model = model
        self._client = client if client is not None else AsyncOpenAI(
            api_key=api_key,
            timeout=timeout_seconds,
        )

    async def parse(
        self,
        messages: list[ChatCompletionMessageParam],
    ) -> LLMGenerationContext:
        try:
            completion = await self._client.beta.chat.completions.parse(
                model=self._model,
                messages=messages,
                response_format=LLMGenerationContext,
            )
        except Exception as exc:
            raise LLMContextGenerationError("LLMの構造化出力に失敗しました") from exc
        return context_from_completion(completion)


class OpenAIPromptEngine(PromptEnginePort):
    """gpt-4o-mini で画像プロンプトとスタイルパラメータを抽出する。"""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "gpt-4o-mini",
        timeout_seconds: float = 20.0,
        transport: PromptTransport | None = None,
    ) -> None:
        self._transport = transport or OpenAIStructuredTransport(
            api_key,
            model=model,
            timeout_seconds=timeout_seconds,
        )

    async def generate_prompt_context(
        self,
        request: FlyerGenerationRequest,
    ) -> LLMGenerationContext:
        messages = build_prompt_messages(request)
        try:
            return await self._transport.parse(messages)
        except LLMContextGenerationError:
            raise
        except Exception as exc:
            raise LLMContextGenerationError("LLMの構造化出力に失敗しました") from exc
