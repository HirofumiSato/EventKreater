"""Pillow でアップロード画像を検証し、9:16 の背景 PNG に揃えるアダプター。"""

from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from src.domain.exceptions import ImageTooLargeError, ImageUploadError
from src.ports.image_upload_port import ImageUploadPort

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920

#: 受け入れる形式。SVG・GIF・アニメーション画像は対象外。
ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})


def _cover(image: Image.Image, width: int, height: int) -> Image.Image:
    """中央基準で切り抜く。プレビューと同じ構図をサーバー側で固定する。"""
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (max(1, int(image.width * scale)), max(1, int(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def _to_rgb(image: Image.Image) -> Image.Image:
    """透過 PNG は白で埋める。透明部分を黒くしない。"""
    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


class PillowUploadNormalizer(ImageUploadPort):
    """形式・画素数・寸法を検証し、EXIF を落として PNG を返す。"""

    def __init__(
        self,
        *,
        max_bytes: int = 8 * 1024 * 1024,
        max_pixels: int = 40_000_000,
        width: int = CANVAS_WIDTH,
        height: int = CANVAS_HEIGHT,
    ) -> None:
        self._max_bytes = max_bytes
        self._max_pixels = max_pixels
        self._width = width
        self._height = height

    def normalize(self, payload: bytes) -> bytes:
        if not payload:
            raise ImageUploadError("アップロードされた画像が空です")
        if len(payload) > self._max_bytes:
            raise ImageTooLargeError(
                f"uploaded image is {len(payload)} bytes, limit is {self._max_bytes}"
            )

        Image.MAX_IMAGE_PIXELS = self._max_pixels
        try:
            with Image.open(BytesIO(payload)) as incoming:
                if incoming.format not in ALLOWED_FORMATS:
                    raise ImageUploadError(
                        f"unsupported image format: {incoming.format}"
                    )
                if getattr(incoming, "n_frames", 1) > 1:
                    raise ImageUploadError("animated images are not supported")
                if incoming.width * incoming.height > self._max_pixels:
                    raise ImageUploadError(
                        f"image has too many pixels: {incoming.width}x{incoming.height}"
                    )
                incoming.load()
                oriented = ImageOps.exif_transpose(incoming)
                rgb = _to_rgb(oriented)
        except ImageUploadError:
            raise
        except (
            UnidentifiedImageError,
            Image.DecompressionBombError,
            OSError,
            ValueError,
        ) as exc:
            raise ImageUploadError("画像データを解釈できません") from exc

        cropped = _cover(rgb, self._width, self._height)
        output = BytesIO()
        # PNG へ書き直すので EXIF・ICC プロファイル・サムネイルは残らない。
        cropped.save(output, format="PNG", optimize=False)
        return output.getvalue()


__all__ = ["PillowUploadNormalizer", "ALLOWED_FORMATS"]
