"""画像生成プロンプトへ渡す「空けるべき領域」の指示。

文字を後から焼き込む前提なので、背景には文字用の平らな面を残させる。座標計算
（`adapters/renderer`）とは分離し、プロンプトを組む層から参照できるようにする。

切り抜きの安全域も同じ場所に置く。画像は 2:3 で生成したあと `_cover()` が A4 縦
（1080×1528）を埋めるように拡大し、はみ出した上下を中央で捨てる。生成側と描画側で
前提がずれないよう、数値の根拠をここ 1 箇所に書く。
"""

from __future__ import annotations

from src.domain.models import LLMGenerationContext, TextLayout

#: 配置プリセットごとの余白指示。AI 背景を入れるときにプロンプトへ連結する。
LAYOUT_NEGATIVE_SPACE_HINTS: dict[TextLayout, str] = {
    TextLayout.CLASSIC: "The upper two thirds must stay uncluttered for a text overlay.",
    TextLayout.TOP_STACK: (
        "The upper two thirds must stay uncluttered; the lower third is free for the subject."
    ),
    TextLayout.CENTER_STACK: (
        "The middle band must stay uncluttered; top and bottom are free."
    ),
    TextLayout.BOTTOM_STACK: (
        "The lower two thirds must stay uncluttered; the upper third is free for the subject."
    ),
}

#: 中央 85% に被写体を寄せる指示。
#:
#: 1024x1536 を 1080 幅へ拡大すると 1080x1620 になり、上下 46px ずつ（5.7%）が落ちる。
#: dall-e-3 の 1024x1792 では 1080x1890 になり、上下 181px ずつ（19.2%）落ちる。
#: 既定は gpt-image-2.5 系だが、モデルを差し替えても構図が破綻しないよう厳しい側に寄せる。
CROP_SAFE_AREA_HINT: str = (
    "Keep the subject and focal point inside the central 85% of the frame; "
    "the top and bottom edges are cropped when fitted to A4."
)


def negative_space_hint(layout: TextLayout) -> str:
    """配置プリセットの余白指示。未知の値は標準へ落とす。"""
    return LAYOUT_NEGATIVE_SPACE_HINTS.get(
        layout,
        LAYOUT_NEGATIVE_SPACE_HINTS[TextLayout.CLASSIC],
    )


def composition_hint(layout: TextLayout) -> str:
    """LLM へ先に伝える構図の指示。余白と切り抜き安全域をまとめる。"""
    return f"{negative_space_hint(layout)}\n{CROP_SAFE_AREA_HINT}"


def prompt_with_layout_hint(
    context: LLMGenerationContext,
    layout: TextLayout,
) -> str:
    """画像生成へ渡す最終プロンプト。LLM の出力に構図の指示を必ず足す。

    LLM が余白や切り抜きに触れずに返してきても構図を保証するための、決定的な
    最終防衛線。`composition_hint` と同じ文面を使うので、二重になっても矛盾しない。
    """
    return f"{context.image_prompt_en.strip()}\n{composition_hint(layout)}"


__all__ = [
    "CROP_SAFE_AREA_HINT",
    "LAYOUT_NEGATIVE_SPACE_HINTS",
    "composition_hint",
    "negative_space_hint",
    "prompt_with_layout_hint",
]
