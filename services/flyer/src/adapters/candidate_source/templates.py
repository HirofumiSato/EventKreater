"""紙面の性格の表示名。ウィザードのステップ 1 で使う。

3 つは同じ格子の変奏で、変わるのは書体・寄せ・面の濃さの 3 つだけ。会場名・
素材名・色名は使わない。色は前段のテーマが決めるため、ここで色を言うと二重に
なる。並び順はこの dict の順で固定する。
"""

from __future__ import annotations

from src.domain.models import TemplateId

TEMPLATE_LABELS: dict[TemplateId, str] = {
    template_id: template_id.paper_character for template_id in TemplateId
}

TEMPLATE_DESCRIPTIONS: dict[TemplateId, str] = {
    TemplateId.STYLE_1_BAR_STYLISH: "明朝で中央に組む。余白を広く取り、罫線は短く。",
    TemplateId.STYLE_2_WARM_EARTH: "ゴシックで左に揃える。紙をわずかに沈めた帯に載せる。",
    TemplateId.STYLE_3_VIBRANT_POP: "極太で左に組む。墨の面に白抜きし、値まで大きく。",
}

__all__ = ["TEMPLATE_DESCRIPTIONS", "TEMPLATE_LABELS"]
