"""文字の積み方のプリセット。

ゾーンを 5 つに割って要素ごとに座標を持たせると、紙面ごとに縦のリズムが壊れる。
ここでは「積みの基準位置」と「タイトルに許す高さ」の 2 つだけを持ち、実際の
スロットの y は `poster.build_poster_plan` が目盛りに載せて決める。

これで変えられるのは紙面の重心だけになり、要素の間隔は常に文法どおりになる。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.adapters.renderer.design import BOTTOM_SAFE, TITLE_MAX_HEIGHT, TOP_SAFE
from src.domain.layout_prompts import (
    LAYOUT_NEGATIVE_SPACE_HINTS as LAYOUT_NEGATIVE_SPACE_HINTS,
)
from src.domain.models import TextLayout

#: 文字の積み方。split は見出しを上端、詳細を下端へ置く。
StackAnchor = Literal["split", "top", "center", "bottom"]


@dataclass(frozen=True)
class StackSpec:
    """1 プリセット分の積み方。"""

    anchor: StackAnchor
    #: 積みの起点。top のときだけ使う。split は安全域の上端、bottom は下端。
    start: int
    #: タイトルに許す高さ。空ける領域が大きいほど大きく組める。
    title_height: int


_LAYOUTS: dict[TextLayout, StackSpec] = {
    # 見出しを上端、詳細を下端へ。写真の主役が真ん中に残る。
    TextLayout.CLASSIC: StackSpec(
        anchor="split",
        start=TOP_SAFE,
        title_height=TITLE_MAX_HEIGHT,
    ),
    # 上へ寄せ、下半分を写真に空ける。
    TextLayout.TOP_STACK: StackSpec(
        anchor="top",
        start=TOP_SAFE,
        title_height=440,
    ),
    # 中央に置き、上下に余白を残す。
    TextLayout.CENTER_STACK: StackSpec(
        anchor="center",
        start=TOP_SAFE,
        title_height=440,
    ),
    # 下へ寄せ、上半分を写真に空ける。
    TextLayout.BOTTOM_STACK: StackSpec(
        anchor="bottom",
        start=BOTTOM_SAFE,
        title_height=400,
    ),
}

#: 背景オーバーレイをどの方向へ濃くするか。
_OVERLAY_ANCHOR: dict[TextLayout, str] = {
    TextLayout.CLASSIC: "center",
    TextLayout.TOP_STACK: "top",
    TextLayout.CENTER_STACK: "center",
    TextLayout.BOTTOM_STACK: "bottom",
}

LAYOUT_LABELS: dict[TextLayout, str] = {
    TextLayout.CLASSIC: "標準",
    TextLayout.TOP_STACK: "上にまとめる",
    TextLayout.CENTER_STACK: "中央にまとめる",
    TextLayout.BOTTOM_STACK: "下にまとめる",
}

LAYOUT_DESCRIPTIONS: dict[TextLayout, str] = {
    TextLayout.CLASSIC: "見出しは上、詳細は下。写真の主役が真ん中に残る",
    TextLayout.TOP_STACK: "文字を上へ。下半分が空くので下に被写体を置ける",
    TextLayout.CENTER_STACK: "中央に置く。上下に余白が残る",
    TextLayout.BOTTOM_STACK: "文字を下へ。上半分が空くので上に被写体を置ける",
}

#: 画像生成プロンプトへ渡す「空けるべき領域」の指示。AI 背景を入れる段階で使う。
#: 本体は `src/domain/layout_prompts.py`。ここから再輸出して既存の参照を保つ。


def stack_for(layout: TextLayout) -> StackSpec:
    """プリセットの積み方を返す。未知の値は既定へ落とす。"""
    return _LAYOUTS.get(layout, _LAYOUTS[TextLayout.CLASSIC])


def overlay_anchor_for(layout: TextLayout) -> str:
    """紙のベールをどの方向へ濃くするか。"""
    return _OVERLAY_ANCHOR.get(layout, "center")


def layout_of(value: object) -> TextLayout:
    """文字列からプリセットへ寄せる。壊れた値でも描画を止めない。"""
    if isinstance(value, TextLayout):
        return value
    try:
        return TextLayout(str(value))
    except ValueError:
        return TextLayout.CLASSIC


__all__ = [
    "LAYOUT_DESCRIPTIONS",
    "LAYOUT_LABELS",
    "LAYOUT_NEGATIVE_SPACE_HINTS",
    "StackAnchor",
    "StackSpec",
    "layout_of",
    "overlay_anchor_for",
    "stack_for",
]
