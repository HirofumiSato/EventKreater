"""アクセント色と遮光の組み合わせ。

`LLMGenerationContext` の制約（6 桁 HEX、alpha は 0.2〜0.7）に必ず収める。
外れると `PillowFlyerRenderer` の検証で弾かれる。

テーマを選んでいるときは、告知ページと同じ差し色から 4 通りを作る。地の明度は
テーマが持つので、ここは「同じ色をどう振るか」だけを決める。
"""

from __future__ import annotations

from dataclasses import dataclass

from src.domain.models import SemanticTheme, TemplateId
from src.domain.semantic_theme import blend, format_hex, parse_hex, shade, theme_look

#: テーマから作る配色の ID。候補メタに残るので変えない。
THEME_PALETTE_ID = "theme"


@dataclass(frozen=True)
class Palette:
    """1 配色。"""

    palette_id: str
    label: str
    description: str
    accent_color: str
    overlay_alpha: float


PALETTES: tuple[Palette, ...] = (
    Palette("gold", "ゴールド", "夜・バー向けの定番", "#F59E0B", 0.55),
    Palette("mono", "モノトーン", "落ち着いた大人向け", "#E5E7EB", 0.60),
    Palette("neon", "ネオン", "ポップで若い層向け", "#22D3EE", 0.45),
    Palette("earth", "ナチュラル", "昼・ファミリー向け", "#D97706", 0.50),
)

PALETTE_BY_ID: dict[str, Palette] = {palette.palette_id: palette for palette in PALETTES}

DEFAULT_PALETTE_BY_TEMPLATE: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "gold",
    TemplateId.STYLE_2_WARM_EARTH: "earth",
    TemplateId.STYLE_3_VIBRANT_POP: "neon",
}


def theme_palettes(theme: SemanticTheme | None) -> tuple[Palette, ...]:
    """テーマの差し色から 4 通りを作る。

    色相は変えない。補色を混ぜるとテーマの世界観から外れるため、明度と彩度だけを
    振り、最後に無彩色へ寄せた「控えめ」を置く。
    """
    look = theme_look(theme)
    accent = parse_hex(look.accent)
    base = parse_hex(look.base)
    ink = parse_hex(look.ink)
    # レンダラーの light スクリムは 0.55 を下限にしている。ここで揃えておくと、
    # メタに残る overlay_alpha と実際の遮光が食い違わない。
    alpha = 0.55
    return (
        Palette(
            THEME_PALETTE_ID,
            look.label,
            "告知ページと同じ差し色",
            format_hex(accent),
            alpha,
        ),
        Palette(
            "theme-soft",
            "淡め",
            "色を薄くして、写真を邪魔しない",
            format_hex(blend(accent, base, 0.45)),
            alpha,
        ),
        Palette(
            "theme-deep",
            "深め",
            "色を濃くして、落ち着いた印象に",
            format_hex(shade(accent, 0.62)),
            alpha,
        ),
        Palette(
            "theme-quiet",
            "控えめ",
            "色数を減らして、文字を主役にする",
            format_hex(blend(ink, base, 0.25)),
            alpha,
        ),
    )


def theme_palette(theme: SemanticTheme | None) -> Palette:
    """テーマの基準色。"""
    return theme_palettes(theme)[0]


def default_palette(
    template_id: TemplateId,
    theme: SemanticTheme | None = None,
) -> Palette:
    """その紙面の既定配色。テーマがあればテーマの差し色を使う。"""
    if theme is not None:
        return theme_palette(theme)
    return PALETTE_BY_ID[DEFAULT_PALETTE_BY_TEMPLATE[template_id]]


def palette_for(
    palette_id: str,
    template_id: TemplateId,
    theme: SemanticTheme | None = None,
) -> Palette:
    """ID から引く。未知の ID は既定へ落とす。"""
    if palette_id == THEME_PALETTE_ID:
        return theme_palette(theme)
    return PALETTE_BY_ID.get(palette_id) or default_palette(template_id, theme)


def palette_candidates(
    template_id: TemplateId,
    theme: SemanticTheme | None,
    current_id: str | None = None,
) -> tuple[Palette, ...]:
    """ステップ 4 に並べる 4 通り。いま選ばれている色を必ず先頭にする。

    テーマがあるときはテーマの 4 通り、無いときは従来の 4 色を並べ替えて返す。
    先頭が現在の色でないと、確定した瞬間に色が飛ぶ。
    """
    if theme is not None:
        return theme_palettes(theme)
    current = PALETTE_BY_ID.get(current_id or "") or default_palette(template_id, theme)
    rest = tuple(palette for palette in PALETTES if palette.palette_id != current.palette_id)
    return (current, *rest)


__all__ = [
    "DEFAULT_PALETTE_BY_TEMPLATE",
    "PALETTES",
    "PALETTE_BY_ID",
    "Palette",
    "THEME_PALETTE_ID",
    "default_palette",
    "palette_candidates",
    "palette_for",
    "theme_palette",
    "theme_palettes",
]
