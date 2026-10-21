"""API を呼ばずにグラデーション背景を返す。"""

from __future__ import annotations

import hashlib

from src.adapters.image_generator.gradients import render_gradient_png
from src.ports.image_generator_port import ImageGeneratorPort


class MockImageGenerator(ImageGeneratorPort):
    """プロンプトのハッシュで色が決まるローカル背景。"""

    async def generate_background(
        self,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str = "9:16",
    ) -> bytes:
        digest = hashlib.sha256(prompt.encode("utf-8")).digest()
        top = (digest[0], digest[1], digest[2])
        bottom = (digest[3], digest[4], digest[5])
        if aspect_ratio == "1:1":
            size = (1080, 1080)
        else:
            size = (1080, 1920)
        return render_gradient_png(size, top, bottom)
