"""画像生成プロンプトへ渡す「空けるべき領域」の指示。

文字を後から焼き込む前提なので、背景には文字用の平らな面を残させる。座標計算
（`adapters/renderer`）とは分離し、プロンプトを組む層から参照できるようにする。

構図は 1 つに固定する。画面は文字の配置を選ばせず、紙面も標準（題は上、明細は
下）で組む。生成のたびに余白の位置が変わると、選んだ紙面と写真が食い違う。

切り抜きの安全域も同じ場所に置く。画像は 2:3 で生成したあと `_cover()` が A4 縦
（1080×1528）を埋めるように拡大し、はみ出した上下を中央で捨てる。生成側と描画側で
前提がずれないよう、数値の根拠をここ 1 箇所に書く。
"""

from __future__ import annotations

from src.domain.models import FlyerGenerationRequest, LLMGenerationContext
from src.domain.visual_hints import (
    LIGHTING_CONSTRAINTS,
    PEOPLE_CONSTRAINTS,
    PeoplePolicy,
    scene_brief,
)

#: 文字の帯を空ける指示。
#:
#: 題は上、明細は下に載る（`adapters/renderer/layouts.py` の標準）。題の帯は
#: 写真の明るさが揃っていないと読めないので、顔や手のような強い形を置かせない。
NEGATIVE_SPACE_HINT: str = (
    "The top and bottom bands must stay uncluttered for text; "
    "the middle band is free for the subject."
)

#: 中央 85% に被写体を寄せる指示。
#:
#: 1024x1536 を 1080 幅へ拡大すると 1080x1620 になり、上下 46px ずつ（5.7%）が落ちる。
#: dall-e-3 の 1024x1792 では 1080x1890 になり、上下 181px ずつ（19.2%）落ちる。
#: 既定は gpt-image-2.5 系だが、モデルを差し替えても構図が破綻しないよう厳しい側に寄せる。
CROP_SAFE_AREA_HINT: str = (
    "Keep the subject and focal point inside the central 85% of the frame; "
    "the top and bottom edges are cropped when fitted to A4."
)

#: 題の帯を平らに保つ指示。描画側はセル単位でコントラストを測ってベールを敷くが、
#: 写真の段階で面を平らにしておくほど、ベールを薄く保てる。
CALM_TITLE_BAND_HINT: str = (
    "Keep the top and bottom bands low-frequency and evenly lit: "
    "no faces, hands, or busy detail inside them, so overlaid text stays readable."
)


def negative_space_hint() -> str:
    """文字のために空ける帯の指示。"""
    return NEGATIVE_SPACE_HINT


def composition_hint() -> str:
    """LLM へ先に伝える構図の指示。余白と切り抜き安全域をまとめる。"""
    return f"{NEGATIVE_SPACE_HINT}\n{CALM_TITLE_BAND_HINT}\n{CROP_SAFE_AREA_HINT}"


def must_depict_hint(request: FlyerGenerationRequest) -> str | None:
    """画像プロンプトの先頭へ置く「必ず残す型」。無ければ None。

    具体的な小道具は書かない。活動・モチーフ・会場・活気・人物方針・光という型だけを
    英語で並べ、題の語から具体化するのは LLM に任せる。型を固定しないと、
    クリスマスの静物・バンドシーン・集合写真のどれか 1 つへ畳まれる。

    人が居る催しでは活気の型も並べる。活動を「静物」ではなく、いちばん動いている
    瞬間（満杯のフロア、勝った瞬間の歓声、ケーキを囲む拍手）へ寄せるためである。
    人が居ない催しでは活気の型を決めないので、ここにも入らない。

    画像モデルは後ろの文より先頭を強く読むため、LLM の文章より前に置く。
    日本語は渡さない。文字として描かれる恐れがあるため。
    """
    brief = scene_brief(request)
    if not brief.has_families:
        return None

    parts: list[str] = list(brief.subjects)
    if brief.people is not None and brief.people is not PeoplePolicy.ABSENT:
        parts.append(PEOPLE_CONSTRAINTS[brief.people])
    if not parts:
        return None

    line = (
        "Must clearly depict, without omitting or replacing with an unrelated still life: "
        + "; ".join(parts)
        + "."
    )
    if brief.people is PeoplePolicy.ABSENT:
        line += f" {PEOPLE_CONSTRAINTS[PeoplePolicy.ABSENT]}"
    if brief.lighting is not None:
        line += f" {LIGHTING_CONSTRAINTS[brief.lighting]}."
    return line


def prompt_with_layout_hint(
    context: LLMGenerationContext,
    request: FlyerGenerationRequest,
) -> str:
    """画像生成へ渡す最終プロンプト。LLM の出力に構図と型の制約を必ず足す。

    LLM が余白や切り抜きに触れずに返してきても構図を保証するための、決定的な
    最終防衛線。`composition_hint` と同じ文面を使うので、二重になっても矛盾しない。

    題から取り出した型は、LLM の文章より **前** に置く。画像モデルは先頭を強く
    読むため、LLM がまた「無関係な静物」へ畳んでも活動と会場が残る。
    辞書に何も無い題では行を足さない（日本語を渡すと文字として描かれる恐れがある）。
    """
    parts = [
        must_depict_hint(request),
        context.image_prompt_en.strip(),
        composition_hint(),
    ]
    return "\n".join(part for part in parts if part)


__all__ = [
    "CALM_TITLE_BAND_HINT",
    "CROP_SAFE_AREA_HINT",
    "NEGATIVE_SPACE_HINT",
    "composition_hint",
    "must_depict_hint",
    "negative_space_hint",
    "prompt_with_layout_hint",
]
