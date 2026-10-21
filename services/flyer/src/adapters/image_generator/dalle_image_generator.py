"""DALL-E 3 背景生成。失敗時は静的フォールバックへ委譲する。"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

import httpx
from openai import AsyncOpenAI
from openai.types import ImagesResponse

from src.adapters.image_generator.gradients import ensure_image_bytes
from src.domain.exceptions import ImageGenerationTimeoutError, InputValidationError
from src.ports.image_generator_port import ImageGeneratorPort

logger = logging.getLogger(__name__)

DalleSize = Literal["1024x1024", "1024x1792", "1792x1024"]
MAX_IMAGE_BYTES: int = 20 * 1024 * 1024
_PROMPT_CHAR_LIMIT: int = 3900


def dalle_size_for_aspect_ratio(aspect_ratio: str) -> DalleSize:
    """9:16 は縦長 1024x1792、1:1 は正方形。"""
    if aspect_ratio == "1:1":
        return "1024x1024"
    if aspect_ratio == "16:9":
        return "1792x1024"
    return "1024x1792"


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
    """OpenAI Images API（DALL-E 3）の薄いクライアント。"""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "dall-e-3",
        client: AsyncOpenAI | None = None,
    ) -> None:
        self._model = model
        self._client = client if client is not None else AsyncOpenAI(api_key=api_key)

    async def generate_image(self, *, prompt: str, size: str, timeout: float) -> bytes:
        size_literal = _as_dalle_size(size)
        try:
            response = await self._client.images.generate(
                model=self._model,
                prompt=prompt,
                size=size_literal,
                quality="standard",
                n=1,
                response_format="url",
                timeout=timeout,
            )
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


def _as_dalle_size(size: str) -> DalleSize:
    if size == "1024x1024":
        return "1024x1024"
    if size == "1792x1024":
        return "1792x1024"
    return "1024x1792"


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
        model: str = "dall-e-3",
        sleep: Callable[[float], Awaitable[None]] | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        if client is None:
            if not api_key:
                raise InputValidationError("OPENAI_API_KEY が未設定です")
            client = OpenAIDalleClient(api_key, model=model)
        self._client = client
        self._fallback = fallback
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max(1, max_attempts)
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
        size = dalle_size_for_aspect_ratio(aspect_ratio)
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
                logger.warning("DALL-E attempt %s failed: %s", attempt, exc)
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
