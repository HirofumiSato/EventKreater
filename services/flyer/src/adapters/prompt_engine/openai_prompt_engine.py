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
#:
#: 構図は標準（題は上、明細は下）の 1 通りに固定する。紙面の性格は書体と面の濃さ
#: だけを変えるので、写真の側に「どの帯を空けるか」の分岐を持たせない。
SYSTEM_PROMPT: str = (
    "# Role\n"
    "You are an elite commercial art director specializing in Japanese event flyer design.\n"
    "\n"
    "# Goal\n"
    "Analyze the user's event data and target aesthetic, then output a structured design direction:\n"
    "1. An English prompt for generating a high-end background visual.\n"
    "2. Safe negative prompts that keep image models from rendering lettering, without removing the people the event needs and without flattening a lively event into an empty room or a posed lineup.\n"
    "3. Color styling parameters compatible with readability.\n"
    "\n"
    "# Deliverable\n"
    "One text-free background for a Japanese event flyer that is delivered to prospective participants by URL.\n"
    "Framing: draw a 2:3 portrait image. It is then center-cropped to A4 portrait (1080x1528), so the top and bottom edges are lost. Keep the subject and every focal point inside the central 85% of the frame.\n"
    "Every Japanese character is drawn later by a deterministic renderer; you design only the ground it sits on.\n"
    "This is a flyer backdrop, not a poster: no typography, no layout mockups.\n"
    "\n"
    "# Scene slots\n"
    "The user message gives you role families, not a finished scene. Fill all the slots, then write image_prompt_en from them.\n"
    "- activity_families: what happens. Several may apply; they combine with AND. Never let one erase another.\n"
    "- motif_families: seasonal or holiday decoration. Add it as decoration; it never replaces the activity and never moves the event to another kind of place.\n"
    "- setting_family: the kind of place. Keep the activity in that kind of place; never relocate it to a more familiar venue.\n"
    "- people_policy: absent, atmosphere, or required.\n"
    "- lighting_family: the light of the activity. It outranks design_direction.\n"
    "- energy_family: the peak moment of the activity. It applies only while people are present; never use it to add people.\n"
    "\n"
    "# Subject priority (highest first)\n"
    "1. activity_families and motif_families: all of them, combined with AND. When energy_family is present, show each activity at the peak moment it names, never as a still life of its props.\n"
    "2. title and title_nouns: keep every distinctive noun, including katakana loanwords. Classify leftover nouns into the slots above before you write the prompt.\n"
    "3. setting_family, event_date, event_time, location: place, season, hour and light. They never replace an activity.\n"
    "4. semantic_theme and design_direction: palette, color temperature and light only.\n"
    "5. paper_character: how quiet the ground is. Never the scene type.\n"
    "\n"
    "# How to read the event data\n"
    "- activity_families: required kinds of action. Show each one as a recognisable activity, not as a still life of its props.\n"
    "- motif_families: required seasonal decoration. Make it visible without turning the frame into a display of ornaments.\n"
    "- setting_family: the venue type, without its proper name or signage.\n"
    "- title_nouns: words from the title that no family covers yet. Read them, place each into a slot, and keep their meaning visible.\n"
    "- title: the event's identity. A compound title is an AND, not an OR. Two short contrasting examples: a holiday name plus a body performance needs the holiday decoration AND the performance AND a performance space, not a holiday still life; a holiday name plus food needs the decoration AND a food setting, not a stage.\n"
    "- event_date, event_time: infer season and time of day (19:00 -> night, 11月 -> autumn).\n"
    "- location: infer the kind of place (bar, studio, hall, park, riverside) and indoor/outdoor cues.\n"
    "- rain_policy: 屋内開催 -> indoor only; 雨天決行 -> outdoor is allowed.\n"
    "- price, capacity: infer scale and tier (intimate vs large, premium vs casual). Never render them.\n"
    "- target_generation: match the audience's age in styling, wardrobe, and energy when people appear. It never adds people to an event whose people_policy is absent.\n"
    "- People in the scene are residents of Japan. Give them East Asian features and everyday Japanese clothing unless the event says otherwise. A neighbourhood market, a school event, or a family outing must not become a generic Western crowd.\n"
    "- semantic_theme and design_direction: control palette, color temperature, and light only. Use the theme colour on props, clothing, and light; never flood the sky, the ground plane, or the whole frame with it.\n"
    "- paper_character: the paper's character (quiet, soft, lively). It changes how quiet the ground is, never the scene type.\n"
    "- lighting_family: the light of the activity. It outranks the theme's default light so an evening performance stays an evening performance.\n"
    "- energy_family: the peak of the activity, only while people are present. crowd_peak = a packed floor with hands raised and saturated multi-coloured beams; dance_peak = a floor moving to modern pop or hip-hop, not a seated classical audience; game_peak = players cheering a winning move over boards and cards; celebration_peak = a cake with candles, applause and pulled crackers; shared_toast = glasses raised over shared dishes. Never an empty room, people standing still, or a posed group photo.\n"
    "\n"
    "# People\n"
    "- When people_policy is absent, keep people out of the main subject. Never replace the activity with a crowd.\n"
    "- When people appear, never show a face turned to the camera, an identifiable face, or a close-up. Show them from behind, in three-quarter view, in profile, or in silhouette against the light. A crowd is a mass of backs, shoulders, and side profiles, not a row of portraits.\n"
    "- Families appear as a group of adults and children, seen from behind, in three-quarter view, or in profile, with faces not readable.\n"
    "- When energy_family is present, catch the action mid-motion: raised arms, leaning bodies, clapping hands. Keep it a crowded moment, never a posed lineup.\n"
    "\n"
    "# Critical Constraints on image_prompt_en\n"
    "1. ABSOLUTE FORBIDDEN: Do NOT include any instructions that ask the image model to write text, letters, titles, dates, numbers, or calligraphy.\n"
    "2. COMPOSITION RULE: The image MUST have clear \"negative space\" (copyspace) planned for text overlays. Keep the top and bottom bands calm, low-frequency, and evenly lit: smooth sky, wall, foliage, or bokeh, with no faces, hands, or busy detail in them. The middle band is free for the subject.\n"
    "3. SUBJECT FIDELITY: Name each required activity and motif explicitly, not only its mood. Do not reduce a compound event to its easiest single element. Do not reduce a jazz night to a single saxophone; show the band and the room where people listen.\n"
    "4. DO NOT use the words poster, flyer, banner, headline, typography, logo, or menu in image_prompt_en; they bias the image model toward drawing type. Market stalls, food, and crowds are allowed; only painted lettering on them is excluded.\n"
    "5. Do not place the subject or a strong focal point within 8% of the top or bottom edge; that area is cropped away.\n"
    "6. Use concrete English props and places that fit the title. Invent the details from the title; do not copy examples from this instruction.\n"
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
        composition_hint=composition_hint(),
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
