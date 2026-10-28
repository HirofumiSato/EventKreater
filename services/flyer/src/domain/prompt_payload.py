"""画像プロンプト用 LLM へ渡す利用者入力を、明示した項目だけに絞る。

`FlyerGenerationRequest` をそのまま JSON 化すると、`count` のような操作パラメータ
まで LLM へ流れる。LLM は渡された項目を「使うべき材料」と解釈するため、画面由来の
項目を増やすたびに無関係な値が混ざる余地が生まれる。

そこで、生成の意図（`generation_purpose`）と、実際に画像へ効かせたい項目だけを
並べたホワイトリストを持つ。項目を増やすときはここへ 1 行足し、同時に
`docs/flyer/specs/context_contract.md` の表を更新する。
"""

from __future__ import annotations

from src.domain.models import FlyerGenerationRequest

#: 何を作るかの宣言。画像モデルではなく、プロンプトを書く LLM 向けの文。
GENERATION_PURPOSE = "a text-free background image for an A4 portrait Japanese event flyer"

#: LLM へ渡す利用者項目。ここに無い項目は、たとえリクエストに在っても渡さない。
#:
#: - `count`: 何枚作るかという操作パラメータで、絵柄に影響しない
#: - `semantic_theme`: 値そのものではなく `design_direction` と対で渡す
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
    "layout_id",
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
    for key in _CONTEXT_KEYS:
        value = dumped.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        payload[key] = value

    theme = request.semantic_theme
    if theme is not None:
        payload["semantic_theme"] = theme.value
        payload["design_direction"] = theme.design_direction

    if composition_hint is not None and composition_hint.strip():
        payload["composition_hint"] = composition_hint.strip()
    return payload


__all__ = ["GENERATION_PURPOSE", "build_prompt_payload"]
