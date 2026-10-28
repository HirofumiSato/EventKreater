"""OpenAI gpt-4o-mini の Structured Outputs で視覚コンテキストを作る。"""

from __future__ import annotations

import json
from typing import Protocol

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from src.domain.exceptions import LLMContextGenerationError
from src.domain.models import FlyerGenerationRequest, LLMGenerationContext
from src.ports.prompt_engine_port import PromptEnginePort

#: 実装仕様書 2.2 のシステムプロンプト。利用者入力はここへ連結しない。
SYSTEM_PROMPT: str = (
    "# Role\n"
    "You are an elite commercial art director specializing in event poster design.\n"
    "\n"
    "# Goal\n"
    "Analyze the user's event data and target aesthetic, then output a structured design direction:\n"
    "1. An English prompt for generating a high-end background visual.\n"
    "2. Safe negative prompts to strictly prevent image models from rendering text.\n"
    "3. Color styling parameters compatible with readability.\n"
    "\n"
    "# Critical Constraints on image_prompt_en\n"
    "1. ABSOLUTE FORBIDDEN: Do NOT include any instructions that ask the image model to write text, letters, titles, dates, numbers, or calligraphy. \n"
    "2. COMPOSITION RULE: The image MUST have clear \"negative space\" (copyspace) specifically planned for text overlays:\n"
    "   - For 'style_1_bar_stylish': The center and lower-third must be dark, atmospheric, out of focus, or uncluttered.\n"
    "   - For 'style_2_warm_earth': Clean, soft, shallow depth of field, natural background with smooth textures.\n"
    "   - For 'style_3_vibrant_pop': Dynamic composition with a central or bottom low-frequency area to hold text legible.\n"
    "3. SUBJECT TRANSLATION: Do not just copy Japanese terms. Translate the emotional core of the event into visual elements (e.g., \"A jazz session at a bar\" -> \"Cinematic close-up of a vintage brass saxophone resting on a polished mahogany counter, soft amber neon bokeh, atmospheric dust motes, dimly lit, 35mm photograph, moody, elegant\").\n"
    "\n"
    "# Output Format\n"
    "Output MUST be strict JSON adhering to the provided schema."
)


def build_prompt_messages(
    request: FlyerGenerationRequest,
) -> list[ChatCompletionMessageParam]:
    """システムプロンプトと、隔離されたユーザー JSON を組み立てる。

    テーマが選ばれていれば、英語の方向付けを `design_direction` として足す。
    システムプロンプトは変えない（仕様書との一致を保つ）。利用者入力はここへ連結しない。
    """
    system_message: ChatCompletionMessageParam = {
        "role": "system",
        "content": SYSTEM_PROMPT,
    }
    payload: dict[str, object] = json.loads(request.model_dump_json())
    theme = request.semantic_theme
    if theme is not None:
        payload["design_direction"] = theme.design_direction
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
