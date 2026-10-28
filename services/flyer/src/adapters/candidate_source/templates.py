"""紙面の性格の表示名。ウィザードのステップ 1 で使う。

3 つは同じ軸（静けさ）の 3 点で、会場名・素材名・色名は使わない。色は前段の
テーマが決めるため、ここで色を言うと二重になる。並び順はこの dict の順で固定する。
"""

from __future__ import annotations

from src.domain.models import TemplateId

TEMPLATE_LABELS: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "静けさ",
    TemplateId.STYLE_2_WARM_EARTH: "やわらかさ",
    TemplateId.STYLE_3_VIBRANT_POP: "にぎやかさ",
}

TEMPLATE_DESCRIPTIONS: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "写真を静かに見せます。文字は中央に、余白を広く。",
    TemplateId.STYLE_2_WARM_EARTH: "読みやすさを優先。文字を左に揃えて、間を詰めません。",
    TemplateId.STYLE_3_VIBRANT_POP: "遠目でも目立ちます。太い文字で、勢いのある紙面に。",
}

__all__ = ["TEMPLATE_DESCRIPTIONS", "TEMPLATE_LABELS"]
