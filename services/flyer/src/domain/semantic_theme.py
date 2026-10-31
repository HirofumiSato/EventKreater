"""告知ページのテーマから、チラシの色と明度を引く。

チラシの見た目は 2 層に分かれる。

- 色と明度: 前段で選んだ `SemanticTheme` が決める（このモジュール）
- 紙面の性格: ウィザードのステップ 1 が決める（書体・寄せ・保護レイヤーの形）

テーマは Web 側の `src/styles/themes.css` が正で、ここは同じ `--st-*` の値を写した
表を持つ。片方だけ変えると紙面と告知ページの色がずれるため、色を変えるときは
`themes.css` とこの表を同じ PR で更新する。

ここは純粋な関数と定数だけを置く。Pillow も外部 SDK も import しない。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.domain.models import SemanticTheme, TemplateId

#: 地の明度。文字色とスクリムの向きはこれで決まる。
Ground = Literal["dark", "light"]

#: 8 ビット RGB。
RGB = tuple[int, int, int]


def parse_hex(value: str) -> RGB:
    """`#RRGGBB` を RGB に直す。壊れた値は黒にする（描画を止めない）。"""
    text = value.lstrip("#")
    if len(text) != 6:
        return (0, 0, 0)
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        return (0, 0, 0)


def format_hex(rgb: RGB) -> str:
    """RGB を `#RRGGBB`（大文字）に直す。"""
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def blend(a: RGB, b: RGB, progress: float) -> RGB:
    """a から b へ progress だけ寄せた色。"""
    t = _clamp(progress)
    return (
        int(round(a[0] + (b[0] - a[0]) * t)),
        int(round(a[1] + (b[1] - a[1]) * t)),
        int(round(a[2] + (b[2] - a[2]) * t)),
    )


def shade(rgb: RGB, factor: float) -> RGB:
    """明度の倍率。1.0 でそのまま、0.8 で暗く、1.15 で明るく。"""
    return (
        max(0, min(255, int(round(rgb[0] * factor)))),
        max(0, min(255, int(round(rgb[1] * factor)))),
        max(0, min(255, int(round(rgb[2] * factor)))),
    )


WHITE: RGB = (255, 255, 255)


@dataclass(frozen=True)
class ThemeLook:
    """テーマ 1 つ分の色。"""

    ground: Ground
    #: 地の色。サンプル紙面の基準になる。
    base: str
    #: 光源とぼけ玉の色。地に奥行きを出すために使う。
    glow: str
    #: 差し色。ステップ 1〜4 を通して同じ値を使う。
    accent: str
    #: 見出しの文字色。地の明度に合わせる。
    ink: str
    #: 補助の文字色。
    ink_sub: str
    #: このテーマに合う紙面の性格。未指定（None）なら勧めない。
    recommended: TemplateId | None
    #: 画面に出す名前。差し色の選択肢に使う。
    label: str


_THEME_LOOKS: dict[SemanticTheme, ThemeLook] = {
    SemanticTheme.MODERN_SLATE: ThemeLook(
        ground="dark",
        base="#0F172A",
        glow="#6366F1",
        accent="#4F46E5",
        ink="#F8FAFC",
        ink_sub="#B6C2D4",
        recommended=TemplateId.STYLE_1_BAR_STYLISH,
        label="夜のスレート",
    ),
    SemanticTheme.ENTERPRISE_CLEAN: ThemeLook(
        ground="light",
        base="#F9FAFB",
        glow="#93C5FD",
        accent="#2563EB",
        ink="#111827",
        ink_sub="#4B5563",
        recommended=TemplateId.STYLE_2_WARM_EARTH,
        label="クリーン",
    ),
    SemanticTheme.PARCHMENT: ThemeLook(
        ground="light",
        base="#F4EEDD",
        glow="#FFF1CF",
        accent="#8B2635",
        ink="#2C221E",
        ink_sub="#6B5A4D",
        recommended=TemplateId.STYLE_1_BAR_STYLISH,
        label="羊皮紙",
    ),
    SemanticTheme.NEO_BRUTALISM: ThemeLook(
        ground="light",
        base="#FAF7EE",
        glow="#FFD84D",
        accent="#FFD84D",
        ink="#17150F",
        ink_sub="#56504A",
        recommended=TemplateId.STYLE_3_VIBRANT_POP,
        label="太枠",
    ),
    SemanticTheme.NEON: ThemeLook(
        ground="dark",
        base="#080811",
        glow="#00F0FF",
        accent="#00F0FF",
        ink="#E2E8F0",
        ink_sub="#9AA8BD",
        recommended=TemplateId.STYLE_3_VIBRANT_POP,
        label="ネオン",
    ),
    SemanticTheme.WASHI: ThemeLook(
        ground="light",
        base="#F7F4EC",
        glow="#E8E0CC",
        accent="#2F4A6D",
        ink="#23201C",
        ink_sub="#57503F",
        recommended=TemplateId.STYLE_1_BAR_STYLISH,
        label="和紙と藍",
    ),
    SemanticTheme.SAGE: ThemeLook(
        ground="light",
        base="#F4F6F1",
        glow="#DCE7D8",
        accent="#4A6B52",
        ink="#22291F",
        ink_sub="#4F5A4B",
        recommended=TemplateId.STYLE_2_WARM_EARTH,
        label="余白",
    ),
    SemanticTheme.CANDY: ThemeLook(
        ground="light",
        base="#FFF8F2",
        glow="#FFD1DE",
        accent="#FF4D84",
        ink="#3A2430",
        ink_sub="#6B4A58",
        recommended=TemplateId.STYLE_3_VIBRANT_POP,
        label="キャンディ",
    ),
    SemanticTheme.DUSK: ThemeLook(
        ground="dark",
        base="#1C1410",
        glow="#FF8A4C",
        accent="#FF8A4C",
        ink="#F6EFE6",
        ink_sub="#CBB9A8",
        recommended=TemplateId.STYLE_2_WARM_EARTH,
        label="夕暮れ",
    ),
}

#: テーマ未選択のときの紙面。白い地に無難な差し色で、どの催しにも馴染む。
DEFAULT_LOOK: ThemeLook = ThemeLook(
    ground="light",
    base="#F6F7F9",
    glow="#FDE68A",
    accent="#F59E0B",
    ink="#1F2937",
    ink_sub="#4B5563",
    recommended=None,
    label="標準",
)


def theme_look(theme: SemanticTheme | None) -> ThemeLook:
    """テーマの色。未指定・未知は標準へ落とす。"""
    if theme is None:
        return DEFAULT_LOOK
    return _THEME_LOOKS.get(theme, DEFAULT_LOOK)


def theme_key(theme: SemanticTheme | None) -> str:
    """キャッシュの鍵。プロセスを跨いでも同じ値になる文字列を返す。"""
    return theme.value if theme is not None else "default"


__all__ = [
    "DEFAULT_LOOK",
    "Ground",
    "RGB",
    "ThemeLook",
    "WHITE",
    "blend",
    "format_hex",
    "parse_hex",
    "shade",
    "theme_key",
    "theme_look",
]
