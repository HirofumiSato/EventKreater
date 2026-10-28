"""Pillow による決定論的チラシ合成。

このモジュールは外部 API を呼ばない。背景バイト列と確定テキストだけを描く。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from src.adapters.renderer.layout_calculator import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    HIGH_FREQUENCY_EDGE_VARIANCE,
    SHORT_TITLE_LETTER_SPACING,
    SHORT_TITLE_MAX_CHARS,
    TITLE_LINE_SPACING_RATIO,
    Zone,
    average_rgb,
    calculate_optimal_font_and_lines,
    calculate_title_layout,
    choose_backdrop,
    contrast_ratio,
    edge_variance,
    hex_to_rgb,
    line_width,
    load_font,
    measure_text_block,
    relative_luminance,
    single_line_height,
    title_line_origins,
)
from src.adapters.renderer.layouts import (
    LayoutZones,
    overlay_anchor_for,
    zones_for,
)
from src.domain.exceptions import FontRenderError, RenderingError
from src.domain.models import (
    FlyerGenerationRequest,
    LLMGenerationContext,
    RenderMetadata,
    TemplateId,
)
from src.domain.semantic_theme import Ground, ThemeLook, theme_look
from src.ports.renderer_port import FlyerRendererPort

FontRole = Literal["serif", "sans", "display"]
Alignment = Literal["center", "left"]
#: 文字の下に敷く保護レイヤーの形。色ではなく形だけを持つ。
#: - scrim: 地の明度に合わせたベタのグラデーション
#: - card: 白い角丸のカード
#: - panel: 暗いパネルに差し色の枠
Protection = Literal["scrim", "card", "panel"]


@dataclass(frozen=True)
class TemplateStyle:
    """紙面の性格ごとの書体・寄せ・保護レイヤーの形。

    色は持たない。地の明度と文字色は前段のテーマ（`ThemeLook`）が決める。
    """

    font_role: FontRole
    alignment: Alignment
    protection: Protection
    #: card / panel の塗りの不透明度。scrim は LLM の overlay_alpha を使う。
    plate_alpha: float


@dataclass(frozen=True)
class RenderInk:
    """保護レイヤーの上に載る文字色。"""

    title: tuple[int, int, int]
    body: tuple[int, int, int]


_STYLES: dict[TemplateId, TemplateStyle] = {
    TemplateId.STYLE_1_BAR_STYLISH: TemplateStyle(
        font_role="serif",
        alignment="center",
        protection="scrim",
        plate_alpha=0.55,
    ),
    TemplateId.STYLE_2_WARM_EARTH: TemplateStyle(
        font_role="sans",
        alignment="left",
        protection="card",
        plate_alpha=0.90,
    ),
    TemplateId.STYLE_3_VIBRANT_POP: TemplateStyle(
        font_role="display",
        alignment="left",
        protection="panel",
        plate_alpha=0.86,
    ),
}

#: 白いカードの上に載せる文字色。地の明度に関係なく固定する。
_DARK_INK = RenderInk(title=(31, 35, 40), body=(75, 70, 62))
#: 暗いパネルの上に載せる文字色。地の明度に関係なく固定する。
_LIGHT_INK = RenderInk(title=(255, 255, 255), body=(243, 244, 246))


def inks_for(style: TemplateStyle, look: ThemeLook) -> RenderInk:
    """保護レイヤーに応じた文字色。

    scrim は地の明度に合わせる。card は白い面、panel は暗い面なので、テーマの
    明るさに関係なく固定したほうが読みやすい。
    """
    if style.protection == "card":
        return _DARK_INK
    if style.protection == "panel":
        return _LIGHT_INK
    return RenderInk(hex_to_rgb(look.ink), hex_to_rgb(look.ink_sub))


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
    return _cover(loaded, CANVAS_WIDTH, CANVAS_HEIGHT)


def _anchor_weight(anchor: str, progress: float) -> float:
    """文字が載る側を濃くする重み。anchor は top / center / bottom。"""
    if anchor == "top":
        return 0.5 + 0.5 * (1.0 - progress)
    if anchor == "center":
        return 0.5 + 0.5 * (1.0 - abs(2.0 * progress - 1.0))
    return 0.5 + 0.5 * progress


def _dark_gradient(
    size: tuple[int, int],
    overlay_alpha: float,
    anchor: str = "bottom",
) -> Image.Image:
    """文字が載る側を濃くする黒グラデーション。暗い地で使う。"""
    width, height = size
    column = Image.new("L", (1, height))
    for y in range(height):
        progress = y / max(1, height - 1)
        strength = min(0.85, overlay_alpha * _anchor_weight(anchor, progress))
        column.putpixel((0, y), int(strength * 255))
    alpha = column.resize((width, height), Image.Resampling.BILINEAR)
    black = Image.new("RGBA", size, (0, 0, 0, 255))
    black.putalpha(alpha)
    return black


def _light_gradient(
    size: tuple[int, int],
    overlay_alpha: float,
    anchor: str = "bottom",
) -> Image.Image:
    """文字が載る側を白く飛ばすスクリム。明るい地で使う。

    暗い文字を載せる前提なので、暗い地のスクリムより薄くはしない。0.55 を下回ると
    写真の上で本文が読みにくくなる。
    """
    width, height = size
    base = min(0.75, max(0.55, overlay_alpha))
    column = Image.new("L", (1, height))
    for y in range(height):
        progress = y / max(1, height - 1)
        strength = min(0.85, base * _anchor_weight(anchor, progress))
        column.putpixel((0, y), int(strength * 255))
    alpha = column.resize((width, height), Image.Resampling.BILINEAR)
    white = Image.new("RGBA", size, (255, 255, 255, 255))
    white.putalpha(alpha)
    return white


def _apply_base_overlay(
    background: Image.Image,
    style: TemplateStyle,
    context: LLMGenerationContext,
    zones: LayoutZones,
    anchor: str,
    ground: Ground,
) -> Image.Image:
    canvas = background.convert("RGBA")
    if style.protection == "scrim":
        alpha = context.suggested_overlay_alpha
        gradient = (
            _dark_gradient(canvas.size, alpha, anchor)
            if ground == "dark"
            else _light_gradient(canvas.size, alpha, anchor)
        )
        return Image.alpha_composite(canvas, gradient)
    if style.protection == "card":
        overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        top, bottom = zones.text_span
        ImageDraw.Draw(overlay).rounded_rectangle(
            (
                48,
                max(48, top - 80),
                CANVAS_WIDTH - 48,
                min(CANVAS_HEIGHT - 48, bottom + 80),
            ),
            radius=40,
            fill=(255, 255, 255, int(style.plate_alpha * 255)),
        )
        return Image.alpha_composite(canvas, overlay)
    return canvas


def _paint_pop_panel(
    canvas: Image.Image,
    box: tuple[int, int, int, int],
    accent: tuple[int, int, int],
    alpha: int,
) -> Image.Image:
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rounded_rectangle(
        box,
        radius=22,
        fill=(17, 24, 39, alpha),
        outline=(*accent, 255),
        width=4,
    )
    return Image.alpha_composite(canvas, overlay)


def _paint_solid(
    image: Image.Image,
    box: tuple[int, int, int, int],
    color: tuple[int, int, int],
    alpha: float,
) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle(
        box,
        fill=(*color, int(round(alpha * 255))),
    )
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def _clip_box(
    box: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    left = max(0, min(width - 1, left))
    top = max(0, min(height - 1, top))
    right = max(left + 1, min(width, right))
    bottom = max(top + 1, min(height, bottom))
    return (left, top, right, bottom)


def protect_region(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text_rgb: tuple[int, int, int],
) -> tuple[Image.Image, float, bool, bool]:
    """高周波をぼかし、コントラスト不足なら局所バックドロップを敷く。"""
    working = image.convert("RGBA")
    clipped = _clip_box(box, working.width, working.height)
    outline_applied = False
    region = working.crop(clipped)
    if edge_variance(region) >= HIGH_FREQUENCY_EDGE_VARIANCE:
        blurred = region.filter(ImageFilter.GaussianBlur(radius=2))
        working.paste(blurred, clipped)
        outline_applied = True
    mean = average_rgb(working, clipped)
    decision = choose_backdrop(mean, text_rgb)
    backdrop_applied = decision is not None
    if decision is not None:
        pad, alpha = decision
        working = _paint_solid(working, clipped, pad, alpha)
        mean = average_rgb(working, clipped)
        ratio = contrast_ratio(relative_luminance(*text_rgb), relative_luminance(*mean))
        if ratio < 4.5:
            working = _paint_solid(working, clipped, pad, 1.0)
            mean = average_rgb(working, clipped)
            ratio = contrast_ratio(
                relative_luminance(*text_rgb),
                relative_luminance(*mean),
            )
        return working, ratio, backdrop_applied, outline_applied
    ratio = contrast_ratio(relative_luminance(*text_rgb), relative_luminance(*mean))
    return working, ratio, backdrop_applied, outline_applied


def _ink_origin_y(
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    ink_top: int,
) -> int:
    bbox = draw.textbbox((0, 0), "あA", font=font, anchor="lt")
    return int(ink_top - bbox[1])


def _draw_line(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    letter_spacing: int,
    stroke_width: int,
) -> None:
    stroke = (0, 0, 0) if relative_luminance(*fill) > 0.5 else (255, 255, 255)
    x, y = position
    if letter_spacing <= 0:
        draw.text(
            (x, y),
            text,
            font=font,
            fill=fill,
            anchor="lt",
            stroke_width=stroke_width,
            stroke_fill=stroke,
        )
        return
    last_index = len(text) - 1
    for index, char in enumerate(text):
        draw.text(
            (x, y),
            char,
            font=font,
            fill=fill,
            anchor="lt",
            stroke_width=stroke_width,
            stroke_fill=stroke,
        )
        bbox = draw.textbbox((0, 0), char, font=font, anchor="lt")
        x += int(bbox[2] - bbox[0])
        if index < last_index:
            x += letter_spacing


def _draw_lines(
    canvas: Image.Image,
    lines: list[str],
    font: ImageFont.FreeTypeFont,
    zone: Zone,
    ink_top: int,
    fill: tuple[int, int, int],
    alignment: Alignment,
    letter_spacing: int,
    stroke_width: int,
    hanging: bool = False,
) -> None:
    draw = ImageDraw.Draw(canvas)
    line_h = single_line_height(draw, font)
    origin_y = _ink_origin_y(draw, font, ink_top)
    block_w = max(line_width(draw, line, font, letter_spacing) for line in lines)
    origins = title_line_origins(
        draw,
        lines,
        font,
        zone,
        block_w,
        alignment,
        letter_spacing,
        hanging,
    )
    for index, line in enumerate(lines):
        y = origin_y + int(index * line_h * TITLE_LINE_SPACING_RATIO)
        _draw_line(draw, (origins[index], y), line, font, fill, letter_spacing, stroke_width)


def _block_top(zone: Zone, block_h: int, alignment: Alignment, letter_spacing: int) -> int:
    if alignment == "center" and letter_spacing == 0:
        top = zone.y + max(0, (zone.height - block_h) // 2)
    else:
        top = zone.y + 8
    top = min(top, zone.y + zone.height - block_h)
    return max(zone.y, top)


def _draw_icon(
    draw: ImageDraw.ImageDraw,
    origin: tuple[int, int],
    kind: str,
    color: tuple[int, int, int],
) -> None:
    x, y = origin
    if kind == "pin":
        draw.ellipse((x, y, x + 18, y + 18), outline=color, width=2)
        draw.polygon([(x + 9, y + 16), (x + 4, y + 28), (x + 14, y + 28)], fill=color)
        return
    if kind == "ticket":
        draw.rounded_rectangle((x, y + 4, x + 28, y + 24), radius=4, outline=color, width=2)
        return
    draw.ellipse((x, y, x + 12, y + 12), outline=color, width=2)
    draw.ellipse((x + 14, y, x + 26, y + 12), outline=color, width=2)


def _to_jpeg(canvas: Image.Image) -> bytes:
    buffer = BytesIO()
    canvas.convert("RGB").save(buffer, format="JPEG", quality=90, optimize=True)
    return buffer.getvalue()


class PillowFlyerRenderer(FlyerRendererPort):
    """1080×1528（A4 縦）のグリッドへテンプレート別スタイルで文字を合成する。"""

    def __init__(self, font_resolver: FontResolver | None = None) -> None:
        self._fonts = font_resolver or FontResolver()
        self.last_metadata: RenderMetadata | None = None

    def font_path_for(self, template_id: TemplateId) -> str:
        return self._fonts.path_for(_STYLES[template_id].font_role)

    def render_flyer(
        self,
        background_bytes: bytes,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
    ) -> bytes:
        self.last_metadata = None
        style = _STYLES[request.template_id]
        look = theme_look(request.semantic_theme)
        ink = inks_for(style, look)
        zones = zones_for(request.layout_id)
        anchor = overlay_anchor_for(request.layout_id)
        font_path = self.font_path_for(request.template_id)
        background = _decode_background(background_bytes)
        pre_outline = (
            edge_variance(background.crop(zones.b.box)) >= HIGH_FREQUENCY_EDGE_VARIANCE
        )
        if pre_outline:
            blurred_zone = background.crop(zones.b.box).filter(
                ImageFilter.GaussianBlur(radius=12)
            )
            background.paste(blurred_zone, zones.b.box)
        canvas = _apply_base_overlay(
            background,
            style,
            context,
            zones,
            anchor,
            look.ground,
        )
        accent = hex_to_rgb(context.suggested_accent_color)
        spacing = (
            SHORT_TITLE_LETTER_SPACING
            if len(request.title) < SHORT_TITLE_MAX_CHARS
            else 0
        )
        probe = ImageDraw.Draw(canvas)
        title_layout = calculate_title_layout(
            request.title,
            font_path,
            probe,
            max_w=zones.b.width,
            max_h=zones.b.height,
            letter_spacing=spacing,
        )
        title_font, title_lines = title_layout.font, title_layout.lines
        if len(title_lines) > 1:
            # 2 行以上では字間を詰める。意味の区切りを入れる幅を空けるため。
            spacing = 0
        block_w, block_h = measure_text_block(
            probe,
            title_lines,
            title_font,
            letter_spacing=spacing,
        )
        if block_w > zones.b.width or block_h > zones.b.height:
            spacing = 0
            title_layout = calculate_title_layout(
                request.title,
                font_path,
                probe,
                max_w=zones.b.width,
                max_h=zones.b.height,
                letter_spacing=0,
            )
            title_font, title_lines = title_layout.font, title_layout.lines
            block_w, block_h = measure_text_block(probe, title_lines, title_font, letter_spacing=0)
        if (
            not title_lines
            or len(title_lines) > 3
            or block_w > zones.b.width
            or block_h > zones.b.height
        ):
            raise RenderingError("タイトルを指定領域に収められませんでした")

        if style.protection == "panel":
            panel_alpha = max(220, int(context.suggested_overlay_alpha * 255))
            for zone in (zones.a, zones.b, zones.c, zones.d):
                canvas = _paint_pop_panel(canvas, zone.box, accent, panel_alpha)

        ink_top = _block_top(zones.b, block_h, style.alignment, spacing)
        if style.alignment == "center":
            left = zones.b.x + max(0, (zones.b.width - block_w) // 2)
        else:
            left = zones.b.x
        title_box = _clip_box(
            (left - 16, ink_top - 10, left + block_w + 16, ink_top + block_h + 10),
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
        )
        canvas, ratio, backdrop, outline = protect_region(canvas, title_box, ink.title)
        outline = outline or pre_outline
        _draw_lines(
            canvas,
            title_lines,
            title_font,
            zones.b,
            ink_top,
            ink.title,
            style.alignment,
            spacing,
            2 if outline else 0,
            hanging=title_layout.hanging,
        )
        canvas = self._draw_schedule(canvas, request, style, font_path, accent, zones.c, ink)
        canvas = self._draw_details(canvas, request, style, font_path, accent, zones.d, ink)
        canvas = self._draw_footer(canvas, style, accent, zones.e)
        self.last_metadata = RenderMetadata(
            canvas_width=CANVAS_WIDTH,
            canvas_height=CANVAS_HEIGHT,
            template_id=request.template_id,
            layout_id=request.layout_id,
            accent_color=context.suggested_accent_color,
            overlay_alpha=(
                context.suggested_overlay_alpha
                if style.protection == "scrim"
                else style.plate_alpha
            ),
            title_font_size=int(title_font.size),
            title_line_count=len(title_lines),
            title_block_width=block_w,
            title_block_height=block_h,
            title_hanging=title_layout.hanging,
            contrast_ratio=ratio,
            backdrop_applied=backdrop,
            outline_applied=outline,
            letter_spacing_px=spacing,
        )
        return _to_jpeg(canvas)

    def _draw_schedule(
        self,
        canvas: Image.Image,
        request: FlyerGenerationRequest,
        style: TemplateStyle,
        font_path: str,
        accent: tuple[int, int, int],
        zone: Zone,
        ink: RenderInk,
    ) -> Image.Image:
        probe = ImageDraw.Draw(canvas)
        date_font, date_lines = calculate_optimal_font_and_lines(
            request.event_date,
            font_path,
            probe,
            max_w=zone.width,
            max_h=100,
            min_size=28,
            max_size=64,
            max_lines=2,
        )
        date_w, date_h = measure_text_block(probe, date_lines, date_font)
        time_font, time_lines = calculate_optimal_font_and_lines(
            request.event_time,
            font_path,
            probe,
            max_w=zone.width,
            max_h=70,
            min_size=22,
            max_size=36,
            max_lines=2,
        )
        _, time_h = measure_text_block(probe, time_lines, time_font)
        cursor = zone.y + 12
        date_top = cursor
        if style.alignment == "center":
            date_left = zone.x + max(0, (zone.width - date_w) // 2)
        else:
            date_left = zone.x
        date_box = _clip_box(
            (date_left - 8, date_top - 4, date_left + date_w + 8, date_top + date_h + 6),
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
        )
        canvas, _, _, date_outline = protect_region(canvas, date_box, accent)
        _draw_lines(
            canvas,
            date_lines,
            date_font,
            zone,
            date_top,
            accent,
            style.alignment,
            0,
            2 if date_outline else 0,
        )
        time_top = date_top + date_h + 8
        canvas, _, _, time_outline = protect_region(
            canvas,
            _clip_box(
                (zone.x, time_top, zone.x + zone.width, time_top + time_h + 8),
                CANVAS_WIDTH,
                CANVAS_HEIGHT,
            ),
            ink.body,
        )
        _draw_lines(
            canvas,
            time_lines,
            time_font,
            zone,
            time_top,
            ink.body,
            style.alignment,
            0,
            2 if time_outline else 0,
        )
        return self._draw_rain_pill(
            canvas,
            request.rain_policy.value,
            font_path,
            accent,
            min(time_top + time_h + 16, zone.y + zone.height),
            style,
            zone,
        )

    def _draw_rain_pill(
        self,
        canvas: Image.Image,
        label: str,
        font_path: str,
        accent: tuple[int, int, int],
        ink_top: int,
        style: TemplateStyle,
        zone: Zone,
    ) -> Image.Image:
        font = load_font(font_path, 24)
        draw = ImageDraw.Draw(canvas)
        text_w = line_width(draw, label, font, 0)
        text_h = single_line_height(draw, font)
        pad_x = 18
        pad_y = 8
        if style.alignment == "center":
            left = zone.x + max(0, (zone.width - (text_w + pad_x * 2)) // 2)
        else:
            left = zone.x
        top = min(ink_top, zone.y + zone.height - text_h - pad_y * 2 - 4)
        top = max(zone.y, top)
        box = (left, top, left + text_w + pad_x * 2, top + text_h + pad_y * 2)
        ink = (255, 255, 255) if relative_luminance(*accent) < 0.45 else (17, 24, 39)
        draw.rounded_rectangle(box, radius=16, fill=accent)
        _draw_line(
            draw,
            (left + pad_x, _ink_origin_y(draw, font, top + pad_y)),
            label,
            font,
            ink,
            0,
            0,
        )
        return canvas

    def _draw_details(
        self,
        canvas: Image.Image,
        request: FlyerGenerationRequest,
        style: TemplateStyle,
        font_path: str,
        accent: tuple[int, int, int],
        zone: Zone,
        ink: RenderInk,
    ) -> Image.Image:
        rows: list[tuple[str, str]] = [
            ("pin", request.location),
            ("ticket", request.price),
        ]
        if request.capacity:
            rows.append(("people", request.capacity))
        slot_h = zone.height // 3
        for index, (kind, text) in enumerate(rows):
            probe = ImageDraw.Draw(canvas)
            font, lines = calculate_optimal_font_and_lines(
                text,
                font_path,
                probe,
                max_w=zone.width - 64,
                max_h=slot_h - 28,
                min_size=22,
                max_size=40,
                max_lines=2,
            )
            _, block_h = measure_text_block(probe, lines, font)
            slot_top = zone.y + index * slot_h
            text_zone = Zone(
                name=f"D{index}",
                x=zone.x + 48,
                y=slot_top,
                width=zone.width - 56,
                height=slot_h,
            )
            slot_box = (
                zone.x,
                slot_top + 6,
                zone.x + zone.width,
                slot_top + slot_h - 6,
            )
            canvas, _, _, outline = protect_region(canvas, slot_box, ink.body)
            draw = ImageDraw.Draw(canvas)
            _draw_icon(draw, (zone.x + 4, slot_top + 18), kind, accent)
            ink_top = slot_top + max(8, (slot_h - block_h) // 2)
            _draw_lines(
                canvas,
                lines,
                font,
                text_zone,
                ink_top,
                ink.body,
                "left",
                0,
                2 if outline else 0,
            )
        return canvas

    def _draw_footer(
        self,
        canvas: Image.Image,
        style: TemplateStyle,
        accent: tuple[int, int, int],
        zone: Zone,
    ) -> Image.Image:
        draw = ImageDraw.Draw(canvas)
        y = zone.y + zone.height // 2
        if style.alignment == "center":
            draw.line(
                (zone.x + 310, y, zone.x + zone.width - 310, y),
                fill=accent,
                width=3,
            )
        else:
            draw.line((zone.x, y, zone.x + 180, y), fill=accent, width=4)
        return canvas
