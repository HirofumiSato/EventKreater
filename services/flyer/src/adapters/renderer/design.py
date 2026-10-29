"""紙面の規格。目盛り・余白・色の役割をここ 1 箇所で決める。

「その枠に入る最大の字」を置くと、紙面ごとに文字サイズの関係が壊れて揃って
見えない。ここでは比 1.25 の目盛りだけを使い、選べるのはその段だけにする。
余白も 8px の倍数に限定する。紙面の性格（3 種）は、同じ格子の上で書体・寄せ・
面の濃さだけを変える。

このモジュールはドメインの型以外を import しない。Pillow も外部 SDK も使わない。
座標と色の判断は数値だけで行うので、目盛りの検証は画像を作らずにできる。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.domain.models import SemanticTheme, TemplateId
from src.domain.semantic_theme import RGB, ThemeLook, parse_hex

#: A4 縦（210:297）を幅 1080 で表した寸法。1080 * 297 / 210 ≒ 1527.4 を偶数に丸める。
CANVAS_WIDTH: int = 1080
CANVAS_HEIGHT: int = 1528

#: 文字サイズの目盛り。比 1.25 を 8px へ丸めた 11 段だけを使う。
TYPE_SCALE: tuple[int, ...] = (17, 22, 27, 34, 42, 53, 66, 83, 104, 130, 163)

#: タイトルに使える段。大きい順に試し、最初に収まった段を採る。
TITLE_STEPS: tuple[int, ...] = (163, 130, 104, 83, 66, 53, 42)

#: 役割ごとの段。ここに無いサイズは紙面に存在しない。
EYEBROW_SIZE = 22
META_SIZE = 34
FACT_LABEL_SIZE = 22
FACT_VALUE_SIZE = 27
FACT_VALUE_HERO_SIZE = 34
NOTE_SIZE = 17

#: 左右の余白と本文幅。
SIDE_MARGIN = 96
CONTENT_WIDTH = CANVAS_WIDTH - SIDE_MARGIN * 2
#: 天地の安全域。文字はこの内側だけに置く。
TOP_SAFE = 128
BOTTOM_SAFE = CANVAS_HEIGHT - 128
#: すべての縦位置を載せる目盛り。
BASELINE = 8

#: タイトルに許す最大の幅と高さ。
TITLE_MAX_WIDTH = CONTENT_WIDTH
TITLE_MAX_HEIGHT = 480
TITLE_MAX_LINES = 3

#: 行間。見出しは詰め、本文はゆるめる。
HEADING_LINE_RATIO = 1.18
BODY_LINE_RATIO = 1.55
LABEL_LINE_RATIO = 1.2

#: 字間。ラベルは開き、短いタイトルだけ少し開く。
LABEL_TRACKING = 4
SHORT_TITLE_TRACKING = 6
SHORT_TITLE_MAX_CHARS = 10

#: 群と群のあいだの最小の空き。
GAP_AFTER_EYEBROW = 16
GAP_AFTER_TITLE = 24
GAP_AFTER_RULE = 32
GAP_AFTER_META = 24
GAP_AFTER_FACTS = 32
#: 明細の行を分ける罫線の、上下の空き。
FACT_RULE_GAP = 16
#: 明細のラベルと値のあいだの空き。
FACT_LABEL_GAP = 8

#: 配色の下限。本文もこのコントラストを下回らせない。
MIN_CONTRAST = 4.5
WCAG_AA_CONTRAST = MIN_CONTRAST

#: 3 種が変えてよいのは書体・寄せ・面の濃さの 3 つだけ。
FontRole = Literal["serif", "sans", "display"]
Align = Literal["center", "left"]
Surface = Literal["paper", "band", "ink"]
FactsStyle = Literal["stacked", "two_column", "hero"]

#: 面を敷くときの不透明度。写真を透かして地を残す。
#: 足りないときだけ `draw_poster` が墨の 4.5:1 に届く濃さまで上げる。
SURFACE_ALPHA: dict[Surface, float] = {
    # 面を敷かないので値は使われない。
    "paper": 1.0,
    # 紙を 7% 沈めた帯。写真が 18% 透ける。
    "band": 0.82,
    # 墨の面。写真が 14% 透ける。
    "ink": 0.86,
}


def snap(value: float) -> int:
    """8px の目盛りへ丸める。"""
    return int(round(value / BASELINE)) * BASELINE


def line_height(size: int, ratio: float) -> int:
    """1 行の高さ。目盛りに載せる。"""
    return max(BASELINE, snap(size * ratio))


def is_scale_step(size: int) -> bool:
    """目盛りにある段か。"""
    return size in TYPE_SCALE


def step_at_most(size: float) -> int:
    """`size` 以下で最も大きい段。"""
    fits = [step for step in TYPE_SCALE if step <= size]
    return fits[-1] if fits else TYPE_SCALE[0]


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


def _luminance(color: RGB) -> float:
    return relative_luminance(*color)


def _towards(color: RGB, target: RGB, amount: float) -> RGB:
    return blend_rgb(color, target, max(0.0, min(1.0, amount)))


@dataclass(frozen=True)
class PosterVariant:
    """紙面の性格 1 つ分。色は持たない。"""

    template_id: TemplateId
    font_role: FontRole
    align: Align
    surface: Surface
    #: 見出しの下に引く差し色の罫線の長さ。
    rule_width: int
    rule_thickness: int
    facts: FactsStyle


VARIANTS: dict[TemplateId, PosterVariant] = {
    TemplateId.STYLE_1_BAR_STYLISH: PosterVariant(
        template_id=TemplateId.STYLE_1_BAR_STYLISH,
        font_role="serif",
        align="center",
        surface="paper",
        rule_width=96,
        rule_thickness=2,
        facts="stacked",
    ),
    TemplateId.STYLE_2_WARM_EARTH: PosterVariant(
        template_id=TemplateId.STYLE_2_WARM_EARTH,
        font_role="sans",
        align="left",
        surface="band",
        rule_width=CONTENT_WIDTH,
        rule_thickness=1,
        facts="two_column",
    ),
    TemplateId.STYLE_3_VIBRANT_POP: PosterVariant(
        template_id=TemplateId.STYLE_3_VIBRANT_POP,
        font_role="display",
        align="left",
        surface="ink",
        rule_width=240,
        rule_thickness=6,
        facts="hero",
    ),
}


def variant_for(template_id: TemplateId) -> PosterVariant:
    return VARIANTS[template_id]


@dataclass(frozen=True)
class PosterColors:
    """紙面で使う色。差し色は文字に使える濃さへ寄せてある。"""

    paper: RGB
    ink: RGB
    ink_sub: RGB
    #: 罫線と小さなラベルにだけ使う。地に対して 4.5:1 を満たす。
    accent: RGB
    #: 面を敷いたときの地の色。
    surface: RGB
    #: 面の上に載せる文字色。
    on_surface: RGB
    #: 面の上に載せる差し色。
    on_surface_accent: RGB


def ensure_contrast(color: RGB, background: RGB, minimum: float = MIN_CONTRAST) -> RGB:
    """背景に対して最低コントラストを満たすまで、黒か白へ寄せる。

    ネオ・ブルータリズムの黄（#FFE600）や夜のスレートの藍（#4F46E5）は、そのまま
    では明るい紙に載せられない。色相を捨てずに濃さだけを動かす。
    """
    if contrast_ratio(_luminance(color), _luminance(background)) >= minimum:
        return color
    target: RGB = (0, 0, 0) if _luminance(background) > 0.5 else (255, 255, 255)
    adjusted = color
    for step in range(1, 21):
        adjusted = _towards(color, target, step / 20.0)
        if contrast_ratio(_luminance(adjusted), _luminance(background)) >= minimum:
            return adjusted
    return target


def safe_accent(accent: RGB, paper: RGB) -> RGB:
    """罫線と小さなラベルに使える差し色。"""
    return ensure_contrast(accent, paper)


def surface_for(paper: RGB, surface: Surface) -> RGB:
    """面の色。紙の濃さを動かすだけで、境目は罫線が示す。"""
    if surface == "band":
        # 紙をわずかに沈めた帯。写真の上でも「紙が 1 枚重なった」ように見える濃さ。
        amount = 0.07
    elif surface == "ink":
        # 墨の面。紙の明暗を反転させ、文字色も入れ替える。
        amount = 0.93
    else:
        return paper
    target: RGB = (0, 0, 0) if _luminance(paper) > 0.5 else (255, 255, 255)
    return _towards(paper, target, amount)


def colors_for(
    look: ThemeLook,
    surface: Surface,
    accent: RGB | None = None,
) -> PosterColors:
    """テーマから紙面の色を決める。

    `accent` を渡すと、その色を差し色にする（ステップ 4 の配色候補）。
    渡さなければテーマの差し色を使う。
    """
    paper = parse_hex(look.base)
    ink = ensure_contrast(parse_hex(look.ink), paper)
    ink_sub = ensure_contrast(parse_hex(look.ink_sub), paper)
    chosen = accent if accent is not None else parse_hex(look.accent)
    safe = safe_accent(chosen, paper)
    plate = surface_for(paper, surface)
    # 面の上では、紙の側の色を文字色として使う。明暗が必ず反転する。
    on_surface = ensure_contrast(paper, plate)
    return PosterColors(
        paper=paper,
        ink=ink,
        ink_sub=ink_sub,
        accent=safe,
        surface=plate,
        on_surface=on_surface,
        on_surface_accent=safe_accent(chosen, plate),
    )


def colors_for_theme(
    theme: SemanticTheme | None,
    surface: Surface,
    accent: RGB | None = None,
) -> PosterColors:
    """テーマ ID から紙面の色を決める。"""
    from src.domain.semantic_theme import theme_look

    return colors_for(theme_look(theme), surface, accent)


__all__ = [
    "BASELINE",
    "BOTTOM_SAFE",
    "CANVAS_HEIGHT",
    "CANVAS_WIDTH",
    "CONTENT_WIDTH",
    "EYEBROW_SIZE",
    "FACT_LABEL_GAP",
    "FACT_LABEL_SIZE",
    "FACT_RULE_GAP",
    "FACT_VALUE_HERO_SIZE",
    "FACT_VALUE_SIZE",
    "GAP_AFTER_EYEBROW",
    "GAP_AFTER_FACTS",
    "GAP_AFTER_META",
    "GAP_AFTER_RULE",
    "GAP_AFTER_TITLE",
    "HEADING_LINE_RATIO",
    "LABEL_LINE_RATIO",
    "LABEL_TRACKING",
    "META_SIZE",
    "MIN_CONTRAST",
    "NOTE_SIZE",
    "PosterColors",
    "PosterVariant",
    "SHORT_TITLE_MAX_CHARS",
    "SHORT_TITLE_TRACKING",
    "SIDE_MARGIN",
    "SURFACE_ALPHA",
    "TITLE_MAX_HEIGHT",
    "TITLE_MAX_LINES",
    "TITLE_MAX_WIDTH",
    "TITLE_STEPS",
    "TOP_SAFE",
    "TYPE_SCALE",
    "VARIANTS",
    "WCAG_AA_CONTRAST",
    "blend_rgb",
    "colors_for",
    "colors_for_theme",
    "contrast_ratio",
    "ensure_contrast",
    "is_scale_step",
    "line_height",
    "relative_luminance",
    "requires_contrast_protection",
    "safe_accent",
    "snap",
    "step_at_most",
    "surface_for",
    "variant_for",
]
