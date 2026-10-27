"""テンプレート別の静的デフォルト背景。"""

from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

from src.adapters.image_generator.gradients import render_gradient_png
from src.domain.models import TemplateId
from src.ports.image_generator_port import ImageGeneratorPort

_TEMPLATE_STOPS: dict[TemplateId, tuple[tuple[int, int, int], tuple[int, int, int]]] = {
    TemplateId.STYLE_1_BAR_STYLISH: ((12, 16, 32), (42, 24, 18)),
    TemplateId.STYLE_2_WARM_EARTH: ((244, 228, 208), (186, 132, 90)),
    TemplateId.STYLE_3_VIBRANT_POP: ((190, 24, 93), (250, 204, 21)),
}


class StaticFallbackImageGenerator(ImageGeneratorPort):
    """画像 API 失敗時に使う、テンプレート同梱の静的背景。"""

    def __init__(self, directory: Path) -> None:
        self._directory = directory
        self._directory.mkdir(parents=True, exist_ok=True)
        self._template_id = TemplateId.STYLE_1_BAR_STYLISH

    def set_template(self, template_id: TemplateId) -> None:
        self._template_id = template_id

    async def generate_background(
        self,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str = "9:16",
    ) -> bytes:
        return self.load_for_template(self._template_id)

    def load_for_template(self, template_id: TemplateId) -> bytes:
        path = self._directory / f"{template_id.value}_default.png"
        if path.is_file() and path.stat().st_size > 0:
            return path.read_bytes()
        top, bottom = _TEMPLATE_STOPS[template_id]
        payload = render_gradient_png((1080, 1528), top, bottom)
        temporary = path.with_name(f".{path.name}.tmp.{uuid4().hex}")
        temporary.write_bytes(payload)
        os.replace(temporary, path)
        return payload
