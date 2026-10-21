"""背景画像生成のポート。"""

from __future__ import annotations

from abc import ABC, abstractmethod


class ImageGeneratorPort(ABC):
    """指定プロンプトに基づき背景画像の生バイナリを取得する。"""

    @abstractmethod
    async def generate_background(
        self,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str = "9:16",
    ) -> bytes:
        """背景画像バイト列（RGB の PNG または JPEG）を返す。"""
