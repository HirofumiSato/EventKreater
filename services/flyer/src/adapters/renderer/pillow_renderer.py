"""Pillow による決定論的チラシ合成。

このモジュールは外部 API を呼ばない。背景バイト列と確定テキストだけを描く。

処理は 3 段だけにする。

1. 背景を A4 縦へ収める（`_decode_background`）
2. 目盛りからタイトルを選び、スロットを組む（`poster.build_poster_plan`）
3. 面と文字を描く（`poster.draw_poster`）

「面ごとの保護レイヤー（スクリム・カード・パネル）」「アイコン」「ピル」は持たない。
区切りは罫線、読みやすさは紙の色のベールで作る。
"""

from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, ImageDraw

from src.adapters.renderer import design
from src.adapters.renderer.layout_calculator import (
    fit_to_scale,
    load_font,
)
from src.adapters.renderer.layouts import layout_of, stack_for
from src.adapters.renderer.poster import (
    draw_poster,
    measure_contrast,
    plan_for_request,
)
from src.domain.exceptions import FontRenderError, RenderingError
from src.domain.models import (
    FlyerGenerationRequest,
    LLMGenerationContext,
    RenderMetadata,
    TemplateId,
)
from src.domain.semantic_theme import format_hex
from src.ports.renderer_port import FlyerRendererPort

FontRole = Literal["serif", "sans", "display"]


def _windows_font_dir() -> Path:
    windir = os.environ.get("WINDIR", r"C:\Windows")
    return Path(windir) / "Fonts"


def _font_candidates(role: FontRole) -> tuple[Path, ...]:
    windows = _windows_font_dir()
    shared: tuple[Path, ...] = (
        Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
        Path("/System/Library/Fonts/AppleGothic.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"),
    )
    if role == "serif":
        return (
            windows / "NotoSerifJP-VF.ttf",
            windows / "yumin.ttf",
            windows / "msmincho.ttc",
            Path("/System/Library/Fonts/ヒラギノ明朝 ProN.ttc"),
            Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
            *shared,
        )
    if role == "display":
        return (
            windows / "YuGothB.ttc",
            windows / "meiryob.ttc",
            windows / "NotoSansJP-VF.ttf",
            *shared,
            windows / "meiryo.ttc",
        )
    return (
        windows / "NotoSansJP-VF.ttf",
        windows / "YuGothM.ttc",
        windows / "meiryo.ttc",
        *shared,
        windows / "msgothic.ttc",
    )


class FontResolver:
    """テンプレート役割に対応する日本語フォントのパスを解決する。"""

    def path_for(self, role: FontRole) -> str:
        for candidate in _font_candidates(role):
            if not candidate.is_file():
                continue
            try:
                load_font(str(candidate), 32)
            except FontRenderError:
                continue
            return str(candidate)
        raise FontRenderError(f"日本語フォントが見つかりません: {role}")


def _cover(image: Image.Image, width: int, height: int) -> Image.Image:
    rgb = image.convert("RGB")
    scale = max(width / rgb.width, height / rgb.height)
    resized = rgb.resize(
        (max(1, int(rgb.width * scale)), max(1, int(rgb.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def _decode_background(background_bytes: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(background_bytes)) as incoming:
            loaded = incoming.convert("RGB")
    except Exception as exc:
        raise RenderingError("背景画像を読み取れませんでした") from exc
    return _cover(loaded, design.CANVAS_WIDTH, design.CANVAS_HEIGHT)


def _to_jpeg(canvas: Image.Image) -> bytes:
    buffer = BytesIO()
    canvas.convert("RGB").save(buffer, format="JPEG", quality=90, optimize=True)
    return buffer.getvalue()


class PillowFlyerRenderer(FlyerRendererPort):
    """1080×1528（A4 縦）の格子へ、目盛りどおりに文字を載せる。"""

    def __init__(self, font_resolver: FontResolver | None = None) -> None:
        self._fonts = font_resolver or FontResolver()
        self.last_metadata: RenderMetadata | None = None

    def font_path_for(self, template_id: TemplateId) -> str:
        return self._fonts.path_for(design.variant_for(template_id).font_role)

    def render_flyer(
        self,
        background_bytes: bytes,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
    ) -> bytes:
        self.last_metadata = None
        variant = design.variant_for(request.template_id)
        layout = layout_of(request.layout_id)
        stack = stack_for(layout)
        font_path = self.font_path_for(request.template_id)
        background = _decode_background(background_bytes)

        probe = ImageDraw.Draw(background)
        title = fit_to_scale(
            request.title,
            font_path,
            probe,
            max_width=design.CONTENT_WIDTH,
            max_height=stack.title_height,
            allow_hanging=variant.align == "left",
        )
        plan = plan_for_request(
            request,
            title=title,
            stack=stack,
            accent=context.suggested_accent_color,
        )
        report = draw_poster(background, plan, font_path)
        ratio = report.title_contrast

        self.last_metadata = RenderMetadata(
            canvas_width=design.CANVAS_WIDTH,
            canvas_height=design.CANVAS_HEIGHT,
            template_id=request.template_id,
            layout_id=layout,
            accent_color=format_hex(plan.colors.accent),
            overlay_alpha=(
                report.surface_alpha
                if report.surface_alpha is not None
                else (report.veil_alpha or 0.0)
            ),
            title_font_size=plan.title_size,
            title_line_count=plan.title_line_count,
            title_block_width=plan.title_width,
            title_block_height=plan.title_height,
            title_hanging=plan.title_hanging,
            title_color=format_hex(report.title_color),
            title_color_adjusted=report.title_color_adjusted,
            contrast_ratio=max(1.0, min(21.0, ratio)),
            backdrop_applied=report.veil_alpha is not None or plan.surface is not None,
            outline_applied=False,
            letter_spacing_px=title.letter_spacing,
        )
        return _to_jpeg(report.image)


__all__ = ["FontResolver", "PillowFlyerRenderer"]
