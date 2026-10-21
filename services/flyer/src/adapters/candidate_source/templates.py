"""テンプレートの表示名。ウィザードのステップ 1 で使う。"""

from __future__ import annotations

from src.domain.models import TemplateId

TEMPLATE_LABELS: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "バー・スタイリッシュ",
    TemplateId.STYLE_2_WARM_EARTH: "あたたかいアース",
    TemplateId.STYLE_3_VIBRANT_POP: "ビビッド・ポップ",
}

TEMPLATE_DESCRIPTIONS: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "暗い背景に明朝体。夜のイベント向け",
    TemplateId.STYLE_2_WARM_EARTH: "淡い背景に白いカード。昼の集い向け",
    TemplateId.STYLE_3_VIBRANT_POP: "鮮やかな色に太字。ポップな催し向け",
}

__all__ = ["TEMPLATE_DESCRIPTIONS", "TEMPLATE_LABELS"]
