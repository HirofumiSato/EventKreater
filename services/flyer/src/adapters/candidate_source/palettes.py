"""アクセント色と遮光の組み合わせ。

`LLMGenerationContext` の制約（6 桁 HEX、alpha は 0.2〜0.7）に必ず収める。
外れると `PillowFlyerRenderer` の検証で弾かれる。
"""

from __future__ import annotations

from dataclasses import dataclass

from src.domain.models import TemplateId


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


def default_palette(template_id: TemplateId) -> Palette:
    """テンプレートの既定配色。"""
    return PALETTE_BY_ID[DEFAULT_PALETTE_BY_TEMPLATE[template_id]]


def palette_for(palette_id: str, template_id: TemplateId) -> Palette:
    """ID から引く。未知の ID は既定へ落とす。"""
    return PALETTE_BY_ID.get(palette_id) or default_palette(template_id)


__all__ = [
    "DEFAULT_PALETTE_BY_TEMPLATE",
    "PALETTES",
    "PALETTE_BY_ID",
    "Palette",
    "default_palette",
    "palette_for",
]
