"""タイトルの文字色の選択肢。

紙面の地は写真で、しかも 1 枚ごとに違う。題名を墨で固定すると、暗い写真の上で
黒く沈む。ここでは「自動」を先頭に、墨・白・差し色の 4 枚を並べる。自動は
描画時に地の色を見て墨か白を選ぶので、候補の中身は同じ絵でも、選んだ 1 枚が
そのまま完成品になる（確定時に再描画しない）。

色は紙面の性格（`design.PosterVariant`）とテーマから引く。パレットの差し色は
`design` が紙に対して 4.5:1 へ寄せた値を使う。テーマの黄や藍はそのままでは
題名に使えない。
"""

from __future__ import annotations

from dataclasses import dataclass

from src.adapters.renderer import design
from src.domain.models import SemanticTheme, TemplateId
from src.domain.semantic_theme import format_hex, parse_hex

#: 自動の ID。`title_color` を None のまま描く。
AUTO_TITLE_COLOR_ID = "auto"


@dataclass(frozen=True)
class TitleColor:
    """タイトル色 1 つ分。"""

    title_color_id: str
    label: str
    description: str
    #: 描画に渡す色。None は「自動」。
    color: str | None


def title_color_candidates(
    theme: SemanticTheme | None,
    template_id: TemplateId,
    accent: str | None = None,
) -> tuple[TitleColor, ...]:
    """ステップ 5 に並べる 4 通り。並び順は固定で、先頭が「自動」。"""
    variant = design.variant_for(template_id)
    colors = design.colors_for_theme(
        theme,
        variant.surface,
        parse_hex(accent) if accent else None,
    )
    ink = format_hex(colors.ink)
    safe = format_hex(colors.accent)
    return (
        TitleColor(
            AUTO_TITLE_COLOR_ID,
            "自動",
            "背景の明るさに合わせて、墨か白を選ぶ",
            None,
        ),
        TitleColor("ink", "墨", "紙の文字色。明るい写真に合う", ink),
        TitleColor("white", "白", "暗い写真でも題名が沈まない", "#FFFFFF"),
        TitleColor("accent", "差し色", "題名まで配色の色にそろえる", safe),
    )


def title_color_for(
    title_color_id: str | None,
    theme: SemanticTheme | None,
    template_id: TemplateId,
    accent: str | None = None,
) -> TitleColor:
    """ID から引く。未知の ID は「自動」へ落とす。"""
    candidates = title_color_candidates(theme, template_id, accent)
    for option in candidates:
        if option.title_color_id == title_color_id:
            return option
    return candidates[0]


__all__ = [
    "AUTO_TITLE_COLOR_ID",
    "TitleColor",
    "title_color_candidates",
    "title_color_for",
]
