"""幾何レイアウトと WCAG コントラスト計算。

外部 API には触れない。フォントサイズは実装仕様書 3.3 の二分探索、
可読性は 3.4 の相対輝度とコントラスト比で決める。
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat

from src.domain.exceptions import FontRenderError

#: A4 縦（210:297）を幅 1080 で表した寸法。1080 * 297 / 210 ≒ 1527.4 を偶数に丸める。
CANVAS_WIDTH: int = 1080
CANVAS_HEIGHT: int = 1528
TITLE_MAX_WIDTH: int = 920
TITLE_MAX_HEIGHT: int = 336
TITLE_MIN_FONT_SIZE: int = 44
TITLE_MAX_FONT_SIZE: int = 92
TITLE_MAX_LINES: int = 3
TITLE_LINE_SPACING_RATIO: float = 1.3
SHORT_TITLE_MAX_CHARS: int = 10
SHORT_TITLE_LETTER_SPACING: int = 15
WCAG_AA_CONTRAST: float = 4.5
HIGH_FREQUENCY_EDGE_VARIANCE: float = 500.0

_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


@dataclass(frozen=True)
class Zone:
    """基準キャンバス上の矩形ゾーン。"""

    name: str
    x: int
    y: int
    width: int
    height: int

    @property
    def box(self) -> tuple[int, int, int, int]:
        return (self.x, self.y, self.x + self.width, self.y + self.height)


ZONE_A = Zone("A", 80, 128, TITLE_MAX_WIDTH, 48)
ZONE_B = Zone("B", 80, 192, TITLE_MAX_WIDTH, TITLE_MAX_HEIGHT)
ZONE_C = Zone("C", 80, 576, TITLE_MAX_WIDTH, 208)
ZONE_D = Zone("D", 80, 828, TITLE_MAX_WIDTH, 384)
ZONE_E = Zone("E", 80, 1290, TITLE_MAX_WIDTH, 112)


def load_font(font_path: str, size: int) -> ImageFont.FreeTypeFont:
    """TrueType / TrueType コレクションを読み、同一サイズはキャッシュする。"""
    key = (font_path, size)
    cached = _FONT_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        font = ImageFont.truetype(font_path, size=size)
    except OSError as exc:
        raise FontRenderError(f"フォントを読み込めません: {font_path}") from exc
    _FONT_CACHE[key] = font
    return font


def line_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    letter_spacing: int = 0,
) -> int:
    """字間を含めた行幅。"""
    if not text:
        return 0
    if letter_spacing <= 0:
        bbox = draw.textbbox((0, 0), text, font=font, anchor="lt")
        return int(bbox[2] - bbox[0])
    width = 0
    last_index = len(text) - 1
    for index, char in enumerate(text):
        bbox = draw.textbbox((0, 0), char, font=font, anchor="lt")
        width += int(bbox[2] - bbox[0])
        if index < last_index:
            width += letter_spacing
    return width


def single_line_height(draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont) -> int:
    """和文を含む代表グリフのインク高。"""
    bbox = draw.textbbox((0, 0), "あA", font=font, anchor="lt")
    return max(1, int(bbox[3] - bbox[1]))


def block_height(single_line_h: int, line_count: int, line_spacing_ratio: float) -> int:
    """実装仕様書 3.3 の総高さ。"""
    if line_count <= 0:
        return 0
    return int(
        single_line_h * line_count
        + (line_count - 1) * single_line_h * (line_spacing_ratio - 1.0)
    )


def measure_text_block(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    font: ImageFont.FreeTypeFont,
    letter_spacing: int = 0,
    line_spacing_ratio: float = TITLE_LINE_SPACING_RATIO,
) -> tuple[int, int]:
    """折り返し済みテキストブロックの幅と高さ。"""
    if not lines:
        return (0, 0)
    width = max(line_width(draw, line, font, letter_spacing) for line in lines)
    height = block_height(single_line_height(draw, font), len(lines), line_spacing_ratio)
    return (width, height)


def _wrap_lines(
    text: str,
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    max_w: int,
    letter_spacing: int,
) -> list[str]:
    lines: list[str] = []
    current_line = ""
    for char in text:
        test_line = current_line + char
        if line_width(draw, test_line, font, letter_spacing) <= max_w:
            current_line = test_line
            continue
        if current_line:
            lines.append(current_line)
            current_line = char
        else:
            current_line = char
    if current_line:
        lines.append(current_line)
    return lines


def _layout_fits(
    lines: list[str],
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    max_w: int,
    max_h: int,
    line_spacing_ratio: float,
    letter_spacing: int,
    max_lines: int,
) -> bool:
    if not lines or len(lines) > max_lines:
        return False
    width, height = measure_text_block(
        draw,
        lines,
        font,
        letter_spacing,
        line_spacing_ratio,
    )
    return width <= max_w and height <= max_h


def calculate_optimal_font_and_lines(
    text: str,
    font_path: str,
    draw: ImageDraw.ImageDraw,
    max_w: int = TITLE_MAX_WIDTH,
    max_h: int = TITLE_MAX_HEIGHT,
    min_size: int = TITLE_MIN_FONT_SIZE,
    max_size: int = TITLE_MAX_FONT_SIZE,
    line_spacing_ratio: float = TITLE_LINE_SPACING_RATIO,
    letter_spacing: int = 0,
    max_lines: int = TITLE_MAX_LINES,
) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """指定領域に収まるフォントサイズと改行を二分探索で求める。"""
    best_font: ImageFont.FreeTypeFont | None = None
    best_lines: list[str] = []
    low = min_size
    high = max_size

    while low <= high:
        mid_size = (low + high) // 2
        font = load_font(font_path, mid_size)
        lines = _wrap_lines(text, draw, font, max_w, letter_spacing)
        if len(lines) > max_lines:
            high = mid_size - 2
            continue
        if _layout_fits(
            lines,
            draw,
            font,
            max_w,
            max_h,
            line_spacing_ratio,
            letter_spacing,
            max_lines,
        ):
            best_font = font
            best_lines = lines
            low = mid_size + 2
        else:
            high = mid_size - 2

    if best_font is not None and best_lines:
        return best_font, best_lines

    fallback_font = load_font(font_path, min_size)
    sliced = [part for part in (text[:15], text[15:30]) if part]
    if _layout_fits(
        sliced,
        draw,
        fallback_font,
        max_w,
        max_h,
        line_spacing_ratio,
        letter_spacing,
        max_lines,
    ):
        return fallback_font, sliced

    for size in range(min_size, 7, -1):
        font = load_font(font_path, size)
        lines = _wrap_lines(text, draw, font, max_w, letter_spacing)
        if _layout_fits(
            lines,
            draw,
            font,
            max_w,
            max_h,
            line_spacing_ratio,
            letter_spacing,
            max_lines,
        ):
            return font, lines

    raise FontRenderError("テキストを指定領域に収められませんでした")


def _linearize_channel(channel: float) -> float:
    if channel <= 0.04045:
        return channel / 12.92
    return float(((channel + 0.055) / 1.055) ** 2.4)


def relative_luminance(red: float, green: float, blue: float) -> float:
    """WCAG 2.1 の相対輝度。1 を超える値は 0–255 の sRGB として扱う。"""
    if red > 1.0 or green > 1.0 or blue > 1.0:
        red /= 255.0
        green /= 255.0
        blue /= 255.0
    return (
        0.2126 * _linearize_channel(red)
        + 0.7152 * _linearize_channel(green)
        + 0.0722 * _linearize_channel(blue)
    )


def contrast_ratio(luminance_1: float, luminance_2: float) -> float:
    """コントラスト比。明るい方を分子に取る。"""
    lighter = max(luminance_1, luminance_2)
    darker = min(luminance_1, luminance_2)
    return (lighter + 0.05) / (darker + 0.05)


def requires_contrast_protection(
    ratio: float,
    minimum: float = WCAG_AA_CONTRAST,
) -> bool:
    """通常文字の WCAG 2.1 AA（4.5:1）を下回るか。"""
    return ratio < minimum


def blend_rgb(
    background: tuple[int, int, int],
    foreground: tuple[int, int, int],
    alpha: float,
) -> tuple[int, int, int]:
    """foreground を alpha（0–1）で background に合成する。"""
    red = int(round(foreground[0] * alpha + background[0] * (1.0 - alpha)))
    green = int(round(foreground[1] * alpha + background[1] * (1.0 - alpha)))
    blue = int(round(foreground[2] * alpha + background[2] * (1.0 - alpha)))
    return (red, green, blue)


def choose_backdrop(
    background_rgb: tuple[int, int, int],
    text_rgb: tuple[int, int, int],
    minimum: float = WCAG_AA_CONTRAST,
) -> tuple[tuple[int, int, int], float] | None:
    """コントラスト不足なら遮光色と不透明度を返す。足りていれば None。"""
    text_luminance = relative_luminance(*text_rgb)
    background_luminance = relative_luminance(*background_rgb)
    current = contrast_ratio(text_luminance, background_luminance)
    if not requires_contrast_protection(current, minimum):
        return None
    black_contrast = contrast_ratio(text_luminance, 0.0)
    white_contrast = contrast_ratio(text_luminance, 1.0)
    pad = (0, 0, 0) if black_contrast >= white_contrast else (255, 255, 255)
    selected_alpha = 1.0
    for alpha in (0.35, 0.5, 0.65, 0.8, 0.92, 1.0):
        blended = blend_rgb(background_rgb, pad, alpha)
        ratio = contrast_ratio(text_luminance, relative_luminance(*blended))
        selected_alpha = alpha
        if not requires_contrast_protection(ratio, minimum):
            return pad, selected_alpha
    return pad, selected_alpha


def average_rgb(
    image: Image.Image,
    box: tuple[int, int, int, int],
) -> tuple[int, int, int]:
    """矩形領域の平均 sRGB。"""
    crop = image.crop(box).convert("RGB")
    if crop.width <= 0 or crop.height <= 0:
        return (0, 0, 0)
    mean = ImageStat.Stat(crop).mean
    return (int(mean[0]), int(mean[1]), int(mean[2]))


def edge_variance(image: Image.Image) -> float:
    """ラプラシアン相当（FIND_EDGES）の分散。高周波テクスチャの指標。"""
    edges = image.convert("L").filter(ImageFilter.FIND_EDGES)
    variances = ImageStat.Stat(edges).var
    if not variances:
        return 0.0
    return float(variances[0])


def hex_to_rgb(color: str) -> tuple[int, int, int]:
    """#RRGGBB を RGB タプルにする。"""
    stripped = color.removeprefix("#")
    return (
        int(stripped[0:2], 16),
        int(stripped[2:4], 16),
        int(stripped[4:6], 16),
    )
