"""告知ページ（CSS）とチラシ（Python）のテーマ色がずれていないことを確かめる。

テーマの正は `src/styles/themes.css`。ここは同じ値を写した表を持つので、
片方だけ直すと紙面と告知ページで色が食い違う。値を写している以上、テストで留める。

読むのは `--st-surface-base` / `--st-accent-primary` / `--st-content-primary` の 3 つ。
地・差し色・見出しの墨で、紙面の印象を決める値だから。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from src.domain.models import SemanticTheme
from src.domain.semantic_theme import DEFAULT_LOOK, _THEME_LOOKS, theme_look

THEMES_CSS = Path(__file__).resolve().parents[3] / "src" / "styles" / "themes.css"

#: チラシ側の値と突き合わせるトークン。
PAIRS = {
    "base": "--st-surface-base",
    "accent": "--st-accent-primary",
    "ink": "--st-content-primary",
}


def _css() -> str:
    return THEMES_CSS.read_text(encoding="utf-8")


def _theme_block(theme: SemanticTheme) -> str:
    css = _css()
    pattern = re.compile(
        r'\[data-semantic-theme="' + re.escape(theme.value) + r'"\]\s*\{(.*?)\}',
        re.DOTALL,
    )
    match = pattern.search(css)
    assert match, f"themes.css に {theme.value} のブロックがない"
    return match.group(1)


def _hex(block: str, token: str) -> str:
    match = re.search(re.escape(token) + r"\s*:\s*(#[0-9A-Fa-f]{6})\s*;", block)
    assert match, f"{token} が #RRGGBB で書かれていない"
    return match.group(1).upper()


def test_themes_css_exists() -> None:
    assert THEMES_CSS.is_file(), f"themes.css が見つからない: {THEMES_CSS}"


def test_every_theme_has_a_look() -> None:
    missing = [theme.value for theme in SemanticTheme if theme not in _THEME_LOOKS]
    assert missing == [], f"チラシ側の色がないテーマ: {missing}"


def test_look_has_no_unknown_theme() -> None:
    known = {theme.value for theme in SemanticTheme}
    unknown = [theme.value for theme in _THEME_LOOKS if theme.value not in known]
    assert unknown == []


@pytest.mark.parametrize("theme", list(SemanticTheme))
def test_look_colors_match_themes_css(theme: SemanticTheme) -> None:
    block = _theme_block(theme)
    look = theme_look(theme)
    for field, token in PAIRS.items():
        assert getattr(look, field).upper() == _hex(block, token), (
            f"{theme.value} の {field} が themes.css の {token} とずれている"
        )


@pytest.mark.parametrize("theme", list(SemanticTheme))
def test_look_is_described_for_the_prompt(theme: SemanticTheme) -> None:
    look = theme_look(theme)
    assert look.label.strip() != ""
    assert look.ink_sub.upper() != look.base.upper()
    assert theme.design_direction.strip() != ""


def test_default_look_is_not_a_theme() -> None:
    """標準（未選択）はテーマの一覧に混ぜない。"""
    assert DEFAULT_LOOK.label == "標準"
    assert DEFAULT_LOOK.recommended is None
    assert all(look is not DEFAULT_LOOK for look in _THEME_LOOKS.values())
