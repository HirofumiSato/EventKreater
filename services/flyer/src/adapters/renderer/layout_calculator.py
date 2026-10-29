"""文字の計測と、目盛りから字を選ぶ処理。

外部 API には触れない。文字サイズは「その枠に入る最大値」ではなく
`design.TYPE_SCALE` の段から選ぶ。段の外の値を作らないことで、紙面ごとに
階層が崩れない。可読性の判定（相対輝度・コントラスト比）もここに置く。

紙面の寸法と比の数値は `design.py` が持つ。このモジュールはそれを再輸出する。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat

from src.adapters.renderer.design import (  # 再輸出して既存の参照を保つ
    BASELINE,
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    HEADING_LINE_RATIO,
    MIN_CONTRAST,
    SHORT_TITLE_MAX_CHARS,
    SHORT_TITLE_TRACKING,
    TITLE_MAX_HEIGHT,
    TITLE_MAX_LINES,
    TITLE_MAX_WIDTH,
    TITLE_STEPS,
    WCAG_AA_CONTRAST,
    blend_rgb,
    contrast_ratio,
    line_height,
    relative_luminance,
    requires_contrast_protection,
)
from src.domain.exceptions import FontRenderError
from src.domain.title_composition import title_splits

HIGH_FREQUENCY_EDGE_VARIANCE: float = 500.0
#: 最終行を「ぶら下げ」にする条件。最終行がこの文字数以下で、
#: 最長行のこの割合より短いときに、右端へ寄せる。
HANGING_MAX_CHARS: int = 5
HANGING_WIDTH_RATIO: float = 0.7

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


def measure_text_block(
    draw: ImageDraw.ImageDraw,
    lines: Sequence[str],
    font: ImageFont.FreeTypeFont,
    letter_spacing: int = 0,
) -> tuple[int, int]:
    """折り返し済みテキストブロックの幅と高さ。高さは目盛りに載せる。"""
    if not lines:
        return (0, 0)
    width = max(line_width(draw, line, font, letter_spacing) for line in lines)
    height = line_height(int(font.size), HEADING_LINE_RATIO) * len(lines)
    return (width, height)


def _wrap_lines(
    text: str,
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    max_w: int,
) -> list[str]:
    """文字幅だけで折り返す。意味の区切りが取れないときの最後の手段。"""
    lines: list[str] = []
    current_line = ""
    for char in text:
        test_line = current_line + char
        if line_width(draw, test_line, font) <= max_w:
            current_line = test_line
            continue
        if current_line:
            lines.append(current_line)
        current_line = char
    if current_line:
        lines.append(current_line)
    return lines


@dataclass(frozen=True)
class TitleFit:
    """目盛りから選んだタイトルの組み方。"""

    font: ImageFont.FreeTypeFont
    lines: list[str]
    #: 目盛りの段。`design.TYPE_SCALE` のどれか。
    size: int
    width: int
    #: 目盛りに載せたブロックの高さ（行数 × 行送り）。
    height: int
    letter_spacing: int
    #: 最終行をブロックの右端へ寄せるか。左寄せのときだけ使う。
    hanging: bool


def _candidates(text: str, max_lines: int) -> list[tuple[list[str], bool]]:
    """1 行の案を先頭に、意味の区切りで分けた案を評価順に並べる。

    2 つ目は「すべての切れ目が語の区切りで説明できるか」。文字種の変わり目だけで
    切った案（「川辺の焚 / き火ナイト」）は False で、大きさを優先する段でだけ使う。
    """
    candidates: list[tuple[list[str], bool]] = [([text], True)]
    seen: set[tuple[str, ...]] = {(text,)}
    for split in title_splits(text, max_lines):
        lines = list(split.lines)
        key = tuple(lines)
        if key in seen:
            continue
        seen.add(key)
        candidates.append((lines, split.phrase_only))
    return candidates


def _hangs(
    draw: ImageDraw.ImageDraw,
    lines: Sequence[str],
    font: ImageFont.FreeTypeFont,
    letter_spacing: int,
) -> bool:
    """最終行が短いときだけ、右端へぶら下げる。"""
    if len(lines) < 2:
        return False
    last = lines[-1]
    if not 2 <= len(last) <= HANGING_MAX_CHARS:
        return False
    widest = max(line_width(draw, line, font, letter_spacing) for line in lines)
    if widest <= 0:
        return False
    return line_width(draw, last, font, letter_spacing) < widest * HANGING_WIDTH_RATIO


def fit_to_scale(
    text: str,
    font_path: str,
    draw: ImageDraw.ImageDraw,
    *,
    steps: Sequence[int] = TITLE_STEPS,
    max_width: int = TITLE_MAX_WIDTH,
    max_height: int = TITLE_MAX_HEIGHT,
    max_lines: int = TITLE_MAX_LINES,
    allow_hanging: bool = False,
) -> TitleFit:
    """目盛りの大きい段から順に試し、最初に収まった組み方を返す。

    同じ段で複数の切り方が収まるときは、行数が少ないほうを採る。字間は 1 行の
    ときだけ開く。行を分けたときに字間を足すと、意味の区切りの幅が残らない。

    探索は 2 段に分ける。まず語の区切り（空白・句読点・助詞・末尾語）だけで
    切った案を大きい段から試し、どれも収まらないときだけ文字種の変わり目で
    切った案まで広げる。「川辺の焚 / き火ナイト」のように語の途中で折るより、
    1 段小さくして「川辺の / 焚き火ナイト」で組むほうが読みやすい。
    """
    normalized = " ".join(text.split())
    spacing = SHORT_TITLE_TRACKING if len(normalized) <= SHORT_TITLE_MAX_CHARS else 0
    candidates = _candidates(normalized, max_lines)

    for phrase_only_required in (True, False):
        for size in steps:
            leading = line_height(size, HEADING_LINE_RATIO)
            font = load_font(font_path, size)
            fitting: list[tuple[int, int, list[str], int]] = []
            for order, (lines, phrase_only) in enumerate(candidates):
                if phrase_only_required and not phrase_only:
                    continue
                if len(lines) > max_lines:
                    continue
                if leading * len(lines) > max_height:
                    continue
                tracking = spacing if len(lines) == 1 else 0
                width = max(line_width(draw, line, font, tracking) for line in lines)
                if width > max_width:
                    continue
                fitting.append((len(lines), order, lines, width))
            if fitting:
                _, _, lines, width = min(fitting, key=lambda item: (item[0], item[1]))
                tracking = spacing if len(lines) == 1 else 0
                return TitleFit(
                    font=font,
                    lines=lines,
                    size=size,
                    width=width,
                    height=leading * len(lines),
                    letter_spacing=tracking,
                    hanging=allow_hanging and _hangs(draw, lines, font, tracking),
                )

    # どの段でも収まらないときは、最小の段で文字幅だけ折り返す。
    smallest = steps[-1] if steps else 42
    font = load_font(font_path, smallest)
    lines = _wrap_lines(normalized, draw, font, max_width)[:max_lines]
    leading = line_height(smallest, HEADING_LINE_RATIO)
    width = max((line_width(draw, line, font) for line in lines), default=0)
    if not lines or width > max_width:
        raise FontRenderError("タイトルを指定領域に収められませんでした")
    return TitleFit(
        font=font,
        lines=lines,
        size=smallest,
        width=width,
        height=leading * len(lines),
        letter_spacing=0,
        hanging=False,
    )


def title_line_origins(
    draw: ImageDraw.ImageDraw,
    lines: Sequence[str],
    font: ImageFont.FreeTypeFont,
    box: tuple[int, int, int, int],
    alignment: str,
    letter_spacing: int = 0,
    hanging: bool = False,
) -> list[int]:
    """行ごとの描画 x。ぶら下げのときだけ最終行をブロック右端へ寄せる。"""
    if not lines:
        return []
    x, _, width, _ = box
    block_w = max(line_width(draw, line, font, letter_spacing) for line in lines)
    left = x + max(0, (width - block_w) // 2) if alignment == "center" else x
    origins: list[int] = []
    last = len(lines) - 1
    for index, line in enumerate(lines):
        line_w = line_width(draw, line, font, letter_spacing)
        if hanging and index == last:
            origins.append(left + block_w - line_w)
        elif alignment == "center":
            origins.append(left + (block_w - line_w) // 2)
        else:
            origins.append(left)
    return origins


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


def veil_alpha(
    background_rgb: tuple[int, int, int],
    veil_rgb: tuple[int, int, int],
    text_rgb: tuple[int, int, int],
    minimum: float = WCAG_AA_CONTRAST,
) -> float | None:
    """紙の色を薄く敷いて読みやすさを確保する。必要な不透明度を返す。

    黒や白の帯を置く代わりに、紙と同じ色を薄く重ねる。写真の上でも「紙が
    1 枚かかっている」ように見え、角丸の板や黒いスクリムを避けられる。

    敷き切っても届かないとき（文字と敷く色が近いとき）は `None` を返す。
    覆い切れないベールを 1.0 で重ねると、地を塗り潰したうえで読めないままになる。
    """
    text_luminance = relative_luminance(*text_rgb)
    current = contrast_ratio(text_luminance, relative_luminance(*background_rgb))
    if not requires_contrast_protection(current, minimum):
        return None
    for alpha in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
        blended = blend_rgb(background_rgb, veil_rgb, alpha)
        ratio = contrast_ratio(text_luminance, relative_luminance(*blended))
        if not requires_contrast_protection(ratio, minimum):
            return alpha
    return None


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


__all__ = [
    "BASELINE",
    "CANVAS_HEIGHT",
    "CANVAS_WIDTH",
    "HIGH_FREQUENCY_EDGE_VARIANCE",
    "HANGING_MAX_CHARS",
    "HANGING_WIDTH_RATIO",
    "MIN_CONTRAST",
    "SHORT_TITLE_MAX_CHARS",
    "SHORT_TITLE_TRACKING",
    "TITLE_MAX_HEIGHT",
    "TITLE_MAX_LINES",
    "TITLE_MAX_WIDTH",
    "TITLE_STEPS",
    "TitleFit",
    "WCAG_AA_CONTRAST",
    "Zone",
    "average_rgb",
    "blend_rgb",
    "choose_backdrop",
    "contrast_ratio",
    "edge_variance",
    "fit_to_scale",
    "hex_to_rgb",
    "line_height",
    "line_width",
    "load_font",
    "measure_text_block",
    "relative_luminance",
    "requires_contrast_protection",
    "single_line_height",
    "title_line_origins",
    "veil_alpha",
]
