"""画像プロンプト用 LLM へ渡す利用者入力を、明示した項目だけに絞る。

`FlyerGenerationRequest` をそのまま JSON 化すると、`count` のような操作パラメータ
まで LLM へ流れる。LLM は渡された項目を「使うべき材料」と解釈するため、画面由来の
項目を増やすたびに無関係な値が混ざる余地が生まれる。

そこで、生成の意図（`generation_purpose`）と、実際に画像へ効かせたい項目だけを
並べたホワイトリストを持つ。題から取り出した催しの型（活動・モチーフ・会場・
人物方針・光）は、題そのものより先に置く。LLM が題を言い換えて活動を落とさない
よう、先頭で名指しするためである。項目を増やすときはここへ 1 行足し、同時に
`docs/flyer/specs/context_contract.md` の表を更新する。
"""

from __future__ import annotations

from src.domain.models import FlyerGenerationRequest
from src.domain.visual_hints import scene_brief

#: 何を作るかの宣言。画像モデルではなく、プロンプトを書く LLM 向けの文。
GENERATION_PURPOSE = "a text-free background image for an A4 portrait Japanese event flyer"

#: LLM へ渡す利用者項目。ここに無い項目は、たとえリクエストに在っても渡さない。
#:
#: - `count`: 何枚作るかという操作パラメータで、絵柄に影響しない
#: - `semantic_theme`: 値そのものではなく `design_direction` と対で渡す
#: - `layout_id`: 画面が配置を選ばないので、構図は常に `composition_hint` が決める
_CONTEXT_KEYS: tuple[str, ...] = (
    "title",
    "event_date",
    "event_time",
    "price",
    "location",
    "rain_policy",
    "capacity",
    "target_generation",
    "template_id",
)


def build_prompt_payload(
    request: FlyerGenerationRequest,
    *,
    composition_hint: str | None = None,
) -> dict[str, object]:
    """LLM の user メッセージに載せる辞書を組み立てる。純粋関数。

    空文字と `None` はキーごと落とす。LLM に「空の項目」を見せると、値を推測して
    埋めようとするため。Enum は `model_dump(mode="json")` が値へ寄せる。
    """
    dumped = request.model_dump(mode="json")
    payload: dict[str, object] = {
        "generation_purpose": GENERATION_PURPOSE,
    }
    # 催しの型を先頭で名指しする。題を「感情の核」へ言い換えても、この型は残す。
    brief = scene_brief(request)
    if brief.activities:
        payload["activity_families"] = [family.value for family in brief.activities]
    if brief.motifs:
        payload["motif_families"] = [family.value for family in brief.motifs]
    if brief.setting is not None:
        payload["setting_family"] = brief.setting.value
    if brief.people is not None:
        payload["people_policy"] = brief.people.value
    if brief.lighting is not None:
        payload["lighting_family"] = brief.lighting.value
    if brief.energy is not None:
        payload["energy_family"] = brief.energy.value
    if brief.title_nouns:
        payload["title_nouns"] = list(brief.title_nouns)

    for key in _CONTEXT_KEYS:
        value = dumped.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        payload[key] = value

    # 紙面の性格は ID ではなく表示名で渡す。ID の英語（warm earth 等）が
    # 風景の指定と読まれ、題の被写体を上書きするのを避ける。
    payload["paper_character"] = request.template_id.paper_character

    theme = request.semantic_theme
    if theme is not None:
        payload["semantic_theme"] = theme.value
        payload["design_direction"] = theme.design_direction

    if composition_hint is not None and composition_hint.strip():
        payload["composition_hint"] = composition_hint.strip()
    return payload


__all__ = ["GENERATION_PURPOSE", "build_prompt_payload"]
