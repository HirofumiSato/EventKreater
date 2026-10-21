"""ローカルで決定的なグラデーション PNG を作る。"""

from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageDraw

from src.domain.exceptions import ImageGenerationTimeoutError


def mix_rgb(
    top: tuple[int, int, int],
    bottom: tuple[int, int, int],
    progress: float,
) -> tuple[int, int, int]:
    return (
        int(top[0] + (bottom[0] - top[0]) * progress),
        int(top[1] + (bottom[1] - top[1]) * progress),
        int(top[2] + (bottom[2] - top[2]) * progress),
    )


def render_gradient_png(
    size: tuple[int, int],
    top: tuple[int, int, int],
    bottom: tuple[int, int, int],
) -> bytes:
    width, height = size
    column = Image.new("RGB", (1, height))
    draw = ImageDraw.Draw(column)
    for y in range(height):
        progress = y / max(1, height - 1)
        draw.point((0, y), fill=mix_rgb(top, bottom, progress))
    image = column.resize((width, height), Image.Resampling.BILINEAR)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def ensure_image_bytes(payload: bytes) -> None:
    """バイト列が画像として開けることを確認する。"""
    if not payload:
        raise ImageGenerationTimeoutError("画像データが空です")
    try:
        with Image.open(BytesIO(payload)) as image:
            image.load()
    except Exception as exc:
        raise ImageGenerationTimeoutError("画像データを解釈できません") from exc
