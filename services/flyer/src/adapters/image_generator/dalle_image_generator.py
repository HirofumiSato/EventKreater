"""OpenAI Images API の背景生成。失敗時は静的フォールバックへ委譲する。

`gpt-image-1` と `dall-e-3` を同じアダプターで扱う。サイズと画質の語彙が違うため、
要求値は論理サイズ（``1024x1536`` など）で受け取り、クライアントがモデルに合わせて
寄せる。
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol, cast

import httpx
from openai import AsyncOpenAI
from openai.types import ImagesResponse

from src.adapters.image_generator.gradients import ensure_image_bytes
from src.domain.exceptions import ImageGenerationTimeoutError, InputValidationError
from src.domain.pricing import DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, DEFAULT_IMAGE_SIZE
from src.ports.image_generator_port import ImageGeneratorPort

logger = logging.getLogger(__name__)

#: 要求する論理サイズ。A4 縦（1080×1528）に近い縦長を既定にする。
ImageSize = Literal["1024x1024", "1024x1536", "1536x1024"]
GptImageSize = Literal["1024x1024", "1536x1024", "1024x1536", "auto"]
DalleSize = Literal["1024x1024", "1024x1792", "1792x1024"]
GptImageQuality = Literal["low", "medium", "high", "auto"]
DalleQuality = Literal["standard", "hd"]

MAX_IMAGE_BYTES: int = 20 * 1024 * 1024
_PROMPT_CHAR_LIMIT: int = 3900

_DALLE_SIZES: dict[str, DalleSize] = {
    "1024x1024": "1024x1024",
    # dall-e-3 に 1024x1536 は無い。最も近い縦長へ寄せる。
    "1024x1536": "1024x1792",
    "1536x1024": "1792x1024",
    "1024x1792": "1024x1792",
    "1792x1024": "1792x1024",
}

_GPT_IMAGE_SIZES: dict[str, GptImageSize] = {
    "1024x1024": "1024x1024",
    "1024x1536": "1024x1536",
    "1536x1024": "1536x1024",
    "1024x1792": "1024x1536",
    "1792x1024": "1536x1024",
    "auto": "auto",
}

_GPT_IMAGE_QUALITIES: frozenset[str] = frozenset({"low", "medium", "high", "auto"})

#: 論理的な縦横比ごとの要求サイズ。`9:16` は「縦長」の合図として扱う。
_ASPECT_SIZES: dict[str, ImageSize] = {
    "1:1": "1024x1024",
    "9:16": "1024x1536",
    "16:9": "1536x1024",
}


def uses_gpt_image_vocabulary(model: str) -> bool:
    """`gpt-image-1` 系か。サイズ・画質・応答形式の扱いが dall-e-3 と違う。"""
    return model.startswith("gpt-image")


def resolve_image_size(aspect_ratio: str, preferred: str = DEFAULT_IMAGE_SIZE) -> str:
    """1:1 / 16:9 は明示指定を優先し、それ以外は設定の縦長サイズを使う。

    `preferred` は `IMAGE_SIZE` 設定。原価見積り（`DalleCandidateSource`）と同じ値を
    実際のリクエストにも使うため、ここで 1 回だけ決める。`9:16` は比率ではなく
    「縦長で頼む」の合図なので、設定値へ委ねる。
    """
    if aspect_ratio == "1:1":
        return "1024x1024"
    if aspect_ratio == "16:9":
        return "1536x1024"
    return preferred


def dalle_size_for_aspect_ratio(aspect_ratio: str) -> ImageSize:
    """9:16 は縦長 1024x1536、1:1 は正方形、16:9 は横長。"""
    return _ASPECT_SIZES.get(aspect_ratio, "1024x1536")


def compose_image_prompt(prompt: str, negative_prompt: str) -> str:
    """DALL-E 3 はネガティブプロンプト欄が無いため、除外指示を本文へ連結する。"""
    combined = (
        f"{prompt.strip()}\n\n"
        "Do not render any text, letters, numbers, logos, watermarks, or calligraphy.\n"
        f"Avoid: {negative_prompt.strip()}"
    )
    if len(combined) <= _PROMPT_CHAR_LIMIT:
        return combined
    return combined[:_PROMPT_CHAR_LIMIT]


class ImageBytesClient(Protocol):
    """画像バイト列を返すクライアント。"""

    async def generate_image(self, *, prompt: str, size: str, timeout: float) -> bytes:
        """指定サイズの画像バイト列を返す。"""
        ...


async def download_image(
    url: str,
    timeout: float,
    client: httpx.AsyncClient | None = None,
) -> bytes:
    """生成画像 URL からバイト列を取得する。"""
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    try:
        try:
            response = await http.get(url)
            response.raise_for_status()
            payload = response.content
        except Exception as exc:
            raise ImageGenerationTimeoutError("背景画像のダウンロードに失敗しました") from exc
    finally:
        if owns_client:
            await http.aclose()
    if len(payload) > MAX_IMAGE_BYTES:
        raise ImageGenerationTimeoutError("画像サイズが上限を超えています")
    ensure_image_bytes(payload)
    return payload


class OpenAIDalleClient:
    """OpenAI Images API の薄いクライアント。モデルごとに要求を組み立てる。"""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = DEFAULT_IMAGE_MODEL,
        quality: str = DEFAULT_IMAGE_QUALITY,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self._model = model
        self._quality = quality
        self._client = client if client is not None else AsyncOpenAI(api_key=api_key)

    @property
    def model(self) -> str:
        return self._model

    @property
    def quality(self) -> str:
        return self._quality

    async def generate_image(self, *, prompt: str, size: str, timeout: float) -> bytes:
        try:
            response = await self._request(prompt=prompt, size=size, timeout=timeout)
        except Exception as exc:
            raise ImageGenerationTimeoutError("画像生成APIの呼び出しに失敗しました") from exc
        if not isinstance(response, ImagesResponse):
            raise ImageGenerationTimeoutError("画像生成APIが予期しない応答を返しました")
        images = response.data or []
        if not images:
            raise ImageGenerationTimeoutError("画像生成APIが空応答を返しました")
        item = images[0]
        encoded = item.b64_json
        if encoded:
            payload = base64.b64decode(encoded)
            ensure_image_bytes(payload)
            return payload
        if item.url:
            return await download_image(item.url, timeout)
        raise ImageGenerationTimeoutError("画像生成APIが URL を返しませんでした")

    async def _request(self, *, prompt: str, size: str, timeout: float) -> ImagesResponse:
        if uses_gpt_image_vocabulary(self._model):
            # gpt-image-1 は response_format を受け付けず、常に b64_json を返す。
            return await self._client.images.generate(
                model=self._model,
                prompt=prompt,
                size=_as_gpt_image_size(size),
                quality=_as_gpt_image_quality(self._quality),
                n=1,
                timeout=timeout,
            )
        return await self._client.images.generate(
            model=self._model,
            prompt=prompt,
            size=_as_dalle_size(size),
            quality=_as_dalle_quality(self._quality),
            n=1,
            response_format="url",
            timeout=timeout,
        )


def _as_dalle_size(size: str) -> DalleSize:
    return _DALLE_SIZES.get(size, "1024x1792")


def _as_gpt_image_size(size: str) -> GptImageSize:
    return _GPT_IMAGE_SIZES.get(size, "1024x1536")


def resolved_image_size(model: str, size: str) -> str:
    """実際に API へ渡るサイズ。原価の見積りにも同じ値を使う。"""
    if uses_gpt_image_vocabulary(model):
        return _as_gpt_image_size(size)
    return _as_dalle_size(size)


def resolved_image_quality(model: str, quality: str) -> str:
    """実際に API へ渡る画質。原価の見積りにも同じ値を使う。"""
    if uses_gpt_image_vocabulary(model):
        return _as_gpt_image_quality(quality)
    return _as_dalle_quality(quality)



def _as_dalle_quality(value: str) -> DalleQuality:
    if value in ("standard", "hd"):
        return cast(DalleQuality, value)
    if value == "high":
        return "hd"
    return "standard"


def _as_gpt_image_quality(value: str) -> GptImageQuality:
    if value in _GPT_IMAGE_QUALITIES:
        return cast(GptImageQuality, value)
    if value == "hd":
        return "high"
    return "low"


class DalleImageGenerator(ImageGeneratorPort):
    """25 秒の予算でリトライし、失敗したら静的背景へ委譲する。"""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        client: ImageBytesClient | None = None,
        fallback: ImageGeneratorPort | None = None,
        timeout_seconds: float = 25.0,
        max_attempts: int = 2,
        model: str = DEFAULT_IMAGE_MODEL,
        quality: str = DEFAULT_IMAGE_QUALITY,
        size: str = DEFAULT_IMAGE_SIZE,
        sleep: Callable[[float], Awaitable[None]] | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        if client is None:
            if not api_key:
                raise InputValidationError("OPENAI_API_KEY が未設定です")
            client = OpenAIDalleClient(api_key, model=model, quality=quality)
        self._client = client
        self._fallback = fallback
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max(1, max_attempts)
        self._size = size
        self._sleep = sleep or asyncio.sleep
        self._clock = clock or time.monotonic
        self.used_fallback = False

    async def generate_background(
        self,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str = "9:16",
    ) -> bytes:
        self.used_fallback = False
        composed = compose_image_prompt(prompt, negative_prompt)
        size = resolve_image_size(aspect_ratio, self._size)
        deadline = self._clock() + self._timeout_seconds
        last_error: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            remaining = deadline - self._clock()
            if remaining <= 0:
                last_error = ImageGenerationTimeoutError("画像生成が25秒を超過しました")
                break
            try:
                return await asyncio.wait_for(
                    self._client.generate_image(
                        prompt=composed,
                        size=size,
                        timeout=remaining,
                    ),
                    timeout=remaining,
                )
            except Exception as exc:
                last_error = exc
                logger.warning("image generation attempt %s failed: %s", attempt, exc)
                if attempt >= self._max_attempts:
                    break
                pause = min(0.25, max(0.0, deadline - self._clock()))
                if pause > 0:
                    await self._sleep(pause)
        return await self._delegate(prompt, negative_prompt, aspect_ratio, last_error)

    async def _delegate(
        self,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str,
        last_error: Exception | None,
    ) -> bytes:
        self.used_fallback = True
        if self._fallback is None:
            raise ImageGenerationTimeoutError("画像生成APIが失敗しました") from last_error
        logger.warning("delegating image generation to static fallback: %s", last_error)
        return await self._fallback.generate_background(
            prompt,
            negative_prompt,
            aspect_ratio,
        )
