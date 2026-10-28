"""タイトル色の選択肢。

4 通りは並び順を固定し、墨と差し色は紙に対して 4.5:1 を満たす。白だけでなく
「自動」も候補に置くのは、写真の明るさは 1 枚ごとに違い、利用者が毎回選べるとは
限らないためである。
"""

from __future__ import annotations

import pytest

from src.adapters.candidate_source.title_colors import (
    AUTO_TITLE_COLOR_ID,
    title_color_candidates,
    title_color_for,
)
from src.adapters.renderer import design
from src.domain.models import SemanticTheme, TemplateId
from src.domain.semantic_theme import parse_hex


@pytest.mark.parametrize("template_id", list(TemplateId))
@pytest.mark.parametrize("theme", [None, *list(SemanticTheme)])
def test_four_choices_start_with_automatic(
    template_id: TemplateId,
    theme: SemanticTheme | None,
) -> None:
    candidates = title_color_candidates(theme, template_id)
    assert [item.title_color_id for item in candidates] == [
        AUTO_TITLE_COLOR_ID,
        "ink",
        "white",
        "accent",
    ]
    assert candidates[0].color is None
    assert candidates[2].color == "#FFFFFF"
    assert all(item.label and item.description for item in candidates)


@pytest.mark.parametrize("template_id", list(TemplateId))
@pytest.mark.parametrize("theme", [None, *list(SemanticTheme)])
def test_ink_and_accent_stay_readable_on_the_paper(
    template_id: TemplateId,
    theme: SemanticTheme | None,
) -> None:
    """墨と差し色は紙の上で読めなければならない。白は地を寄せて保つので除く。"""
    variant = design.variant_for(template_id)
    paper = design.colors_for_theme(theme, variant.surface).paper
    ink_option = title_color_candidates(theme, template_id)[1]
    accent_option = title_color_candidates(theme, template_id)[3]
    for option in (ink_option, accent_option):
        assert option.color is not None
        ratio = design.contrast_ratio(
            design.relative_luminance(*parse_hex(option.color)),
            design.relative_luminance(*paper),
        )
        assert ratio >= design.MIN_CONTRAST, (option.title_color_id, ratio)


def test_unknown_ids_fall_back_to_automatic() -> None:
    option = title_color_for("rose", None, TemplateId.STYLE_1_BAR_STYLISH)
    assert option.title_color_id == AUTO_TITLE_COLOR_ID
    assert title_color_for(None, None, TemplateId.STYLE_1_BAR_STYLISH).color is None
    assert (
        title_color_for("white", None, TemplateId.STYLE_1_BAR_STYLISH).color
        == "#FFFFFF"
    )
