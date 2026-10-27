"""文字ブロックの配置プリセット。

基準キャンバス 1080×1528（A4 縦）の上で、5 つのゾーン（カテゴリ・タイトル・日時・
詳細・フッター）をまとめて動かす。要素ごとの微調整は許さない。座標を動かすと
`protect_region` のコントラスト保証と自動縮小の前提が崩れるためである。
"""

from __future__ import annotations

from dataclasses import dataclass

from src.adapters.renderer.layout_calculator import TITLE_MAX_WIDTH, Zone
from src.domain.models import TextLayout

#: 左右の余白は全プリセットで共通。横位置を変えるとアイコンと罫線の基準がずれる。
COLUMN_X: int = 80
COLUMN_WIDTH: int = TITLE_MAX_WIDTH


@dataclass(frozen=True)
class LayoutZones:
    """1 プリセット分のゾーン集合。"""

    a: Zone  # カテゴリラベル
    b: Zone  # タイトル
    c: Zone  # 日時・雨天方針
    d: Zone  # 場所・料金・定員
    e: Zone  # フッター罫線

    @property
    def text_span(self) -> tuple[int, int]:
        """文字が載りうる縦範囲。背景オーバーレイの当て先になる。"""
        return self.a.y, self.e.y + self.e.height


def _zones(
    a: tuple[int, int],
    b: tuple[int, int],
    c: tuple[int, int],
    d: tuple[int, int],
    e: tuple[int, int],
) -> LayoutZones:
    return LayoutZones(
        a=Zone("A", COLUMN_X, a[0], COLUMN_WIDTH, a[1]),
        b=Zone("B", COLUMN_X, b[0], COLUMN_WIDTH, b[1]),
        c=Zone("C", COLUMN_X, c[0], COLUMN_WIDTH, c[1]),
        d=Zone("D", COLUMN_X, d[0], COLUMN_WIDTH, d[1]),
        e=Zone("E", COLUMN_X, e[0], COLUMN_WIDTH, e[1]),
    )


#: 詳細設計・実装仕様の既定値。既存チラシと同じ見た目になる。
_CLASSIC = _zones(
    a=(128, 48),
    b=(192, 336),
    c=(576, 208),
    d=(828, 384),
    e=(1290, 112),
)

_LAYOUTS: dict[TextLayout, LayoutZones] = {
    TextLayout.CLASSIC: _CLASSIC,
    # 下側に被写体を置けるよう、文字を上部 65% に寄せる。
    TextLayout.TOP_STACK: _zones(
        a=(88, 44),
        b=(148, 318),
        c=(484, 200),
        d=(700, 342),
        e=(1058, 80),
    ),
    # 上下に余白を残し、中央にまとめる。
    TextLayout.CENTER_STACK: _zones(
        a=(334, 44),
        b=(394, 334),
        c=(742, 200),
        d=(962, 238),
        e=(1218, 64),
    ),
    # 上側に被写体を置けるよう、文字を下部に寄せる。
    TextLayout.BOTTOM_STACK: _zones(
        a=(558, 44),
        b=(616, 302),
        c=(932, 200),
        d=(1144, 262),
        e=(1424, 72),
    ),
}

#: 背景オーバーレイをどの方向へ濃くするか。
_OVERLAY_ANCHOR: dict[TextLayout, str] = {
    TextLayout.CLASSIC: "bottom",
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
    TextLayout.CLASSIC: "上から順に詰める。どんな写真でも合わせやすい",
    TextLayout.TOP_STACK: "文字を上へ。下半分が空くので下に被写体を置ける",
    TextLayout.CENTER_STACK: "中央にまとめる。上下に余白が残る",
    TextLayout.BOTTOM_STACK: "文字を下へ。上半分が空くので上に被写体を置ける",
}

#: 画像生成プロンプトへ渡す「空けるべき領域」の指示。AI 背景を入れる段階で使う。
LAYOUT_NEGATIVE_SPACE_HINTS: dict[TextLayout, str] = {
    TextLayout.CLASSIC: "The upper two thirds must stay uncluttered for a text overlay.",
    TextLayout.TOP_STACK: "The upper two thirds must stay uncluttered; the lower third is free for the subject.",
    TextLayout.CENTER_STACK: "The middle band must stay uncluttered; top and bottom are free.",
    TextLayout.BOTTOM_STACK: "The lower two thirds must stay uncluttered; the upper third is free for the subject.",
}


def zones_for(layout: TextLayout) -> LayoutZones:
    """プリセットのゾーンを返す。未知の値は既定へ落とす。"""
    return _LAYOUTS.get(layout, _CLASSIC)


def overlay_anchor_for(layout: TextLayout) -> str:
    """`_dark_gradient` に渡す濃淡の向き。"""
    return _OVERLAY_ANCHOR.get(layout, "bottom")


def layout_of(value: object) -> TextLayout:
    """文字列からプリセットへ寄せる。壊れた値でも描画を止めない。"""
    if isinstance(value, TextLayout):
        return value
    try:
        return TextLayout(str(value))
    except ValueError:
        return TextLayout.CLASSIC


__all__ = [
    "COLUMN_WIDTH",
    "COLUMN_X",
    "LAYOUT_DESCRIPTIONS",
    "LAYOUT_LABELS",
    "LAYOUT_NEGATIVE_SPACE_HINTS",
    "LayoutZones",
    "layout_of",
    "overlay_anchor_for",
    "zones_for",
]
