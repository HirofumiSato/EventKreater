"""紙面の文法の検証。

画像を作らずに、スロットの文字サイズ・縦位置・色の配分を確かめる。ここが
崩れると「入る最大の字」に戻り、3 枚が別々の文法に見える。
"""

from __future__ import annotations

import inspect

import pytest

from src.adapters.renderer import design, poster
from src.adapters.renderer.layouts import LAYOUT_LABELS, stack_for
from src.adapters.renderer.poster import build_poster_plan
from src.domain.models import TemplateId, TextLayout
from src.domain.semantic_theme import theme_look

FACTS: tuple[tuple[str, str], ...] = (
    ("会場", "Jazz Bar MOON 新宿東口"),
    ("参加費", "3,000円 (1ドリンク付)"),
    ("定員", "先着15名"),
)


def _plan(
    template_id: TemplateId = TemplateId.STYLE_1_BAR_STYLISH,
    layout: TextLayout = TextLayout.CLASSIC,
    lines: tuple[str, ...] = ("ジャズの夜",),
    size: int = 163,
    note: str = "雨天決行",
    title_color: tuple[int, int, int] | None = None,
) -> poster.PosterPlan:
    variant = design.variant_for(template_id)
    colors = design.colors_for(theme_look(None), variant.surface)
    return build_poster_plan(
        variant=variant,
        colors=colors,
        stack=stack_for(layout),
        title_lines=list(lines),
        title_size=size,
        title_width=800,
        title_hanging=False,
        event_date="2026年11月15日(日)",
        event_time="19:00〜22:00 (開場 18:30)",
        facts=FACTS,
        note=note,
        title_color=title_color,
    )


@pytest.mark.parametrize("template_id", list(TemplateId))
@pytest.mark.parametrize("layout", list(TextLayout))
def test_every_size_comes_from_the_scale(
    template_id: TemplateId,
    layout: TextLayout,
) -> None:
    for slot in _plan(template_id, layout).slots:
        assert design.is_scale_step(slot.size), (slot.role, slot.size)


@pytest.mark.parametrize("template_id", list(TemplateId))
def test_every_vertical_position_sits_on_the_8px_baseline(template_id: TemplateId) -> None:
    plan = _plan(template_id)
    for slot in plan.slots:
        assert slot.box[1] % design.BASELINE == 0, (slot.role, slot.box)
        assert slot.leading % design.BASELINE == 0, (slot.role, slot.leading)
    for rule in plan.rules:
        assert rule.box[1] % design.BASELINE == 0, (rule.role, rule.box)


@pytest.mark.parametrize("template_id", list(TemplateId))
def test_text_stays_inside_the_safe_area(template_id: TemplateId) -> None:
    for layout in TextLayout:
        plan = _plan(template_id, layout)
        top, bottom = plan.block
        assert top >= design.TOP_SAFE
        assert bottom <= design.BOTTOM_SAFE
        for slot in plan.slots:
            _, y, _, height = slot.box
            assert y >= design.TOP_SAFE
            assert y + height <= design.BOTTOM_SAFE


@pytest.mark.parametrize("template_id", list(TemplateId))
def test_the_accent_is_kept_for_the_rule_not_the_text(template_id: TemplateId) -> None:
    """差し色は見出し下の罫線だけ。文字には使わない（見出しは 1 色にそろえる）。"""
    plan = _plan(template_id)
    accent = plan.colors.accent
    text_uses = [slot.role for slot in plan.slots if slot.color == accent]
    assert text_uses == [], text_uses
    headline = [rule for rule in plan.rules if rule.role == "headline"]
    assert len(headline) == 1
    assert headline[0].color == accent


@pytest.mark.parametrize("template_id", list(TemplateId))
def test_the_headline_slots_share_one_colour(template_id: TemplateId) -> None:
    """日付・時刻・題の 3 つは同じ色。階層は大きさと字間だけが示す。"""
    plan = _plan(template_id)
    eyebrow = plan.slot("eyebrow")
    meta = plan.slot("meta")
    title = plan.slot("title")
    assert eyebrow is not None and meta is not None and title is not None
    assert eyebrow.color == meta.color == title.color


def test_the_three_tiles_share_one_grid() -> None:
    """3 種は同じ格子の変奏。左右の余白と縦の起点は動かさない。"""
    plans = [_plan(template_id) for template_id in TemplateId]
    blocks = {(plan.block[0], plan.slots[0].box[0], plan.slots[0].box[2]) for plan in plans}
    assert len(blocks) == 1, blocks
    for plan in plans:
        assert plan.slots[0].box[0] == design.SIDE_MARGIN
        assert plan.slots[0].box[2] == design.CONTENT_WIDTH


def test_the_title_is_the_largest_text_on_the_page() -> None:
    for template_id in TemplateId:
        plan = _plan(template_id, size=104)
        title = plan.slot("title")
        assert title is not None
        others = [slot.size for slot in plan.slots if slot.role != "title"]
        assert title.size >= max(others)


def test_meta_is_smaller_than_the_title_and_larger_than_the_note() -> None:
    plan = _plan()
    title = plan.slot("title")
    meta = plan.slot("meta")
    note = plan.slot("note")
    assert title is not None and meta is not None and note is not None
    assert title.size > meta.size > note.size


def test_facts_carry_labels_instead_of_icons() -> None:
    plan = _plan()
    labels = [slot.text for slot in plan.slots if slot.role.startswith("fact_label_")]
    assert labels == ["会場", "参加費", "定員"]
    values = [slot.text for slot in plan.slots if slot.role.startswith("fact_value_")]
    assert values == ["Jazz Bar MOON 新宿東口", "3,000円 (1ドリンク付)", "先着15名"]


def test_two_column_facts_put_the_value_on_the_right() -> None:
    plan = _plan(TemplateId.STYLE_2_WARM_EARTH)
    value = plan.slot("fact_value_0")
    assert value is not None
    assert value.align == "right"
    assert value.box[0] > design.SIDE_MARGIN


def test_slots_do_not_overlap() -> None:
    plan = _plan(TemplateId.STYLE_3_VIBRANT_POP)
    ordered = sorted(plan.slots, key=lambda slot: slot.box[1])
    for index, slot in enumerate(ordered[:-1]):
        following = ordered[index + 1]
        assert slot.box[1] + slot.box[3] <= following.box[1], (slot.role, following.role)


@pytest.mark.parametrize("layout", list(TextLayout))
def test_layouts_only_move_the_stack(layout: TextLayout) -> None:
    """配置は積みの基準位置だけを変える。文字の大きさは変えない。"""
    classic = _plan(layout=TextLayout.CLASSIC)
    other = _plan(layout=layout)
    baseline_sizes = sorted(slot.size for slot in classic.slots)
    other_sizes = sorted(slot.size for slot in other.slots)
    assert baseline_sizes == other_sizes
    assert LAYOUT_LABELS[layout]


def test_bottom_stack_sits_lower_than_top_stack() -> None:
    top = _plan(layout=TextLayout.TOP_STACK)
    bottom = _plan(layout=TextLayout.BOTTOM_STACK)
    assert top.block[1] < bottom.block[1]


def test_the_ink_surface_covers_the_details() -> None:
    plan = _plan(TemplateId.STYLE_3_VIBRANT_POP)
    assert plan.surface is not None
    x1, y1, x2, y2 = plan.surface
    assert (x1, x2) == (0, design.CANVAS_WIDTH)
    assert y2 == design.CANVAS_HEIGHT
    for slot in plan.slots:
        if slot.role == "note" or slot.role.startswith("fact"):
            assert slot.box[1] >= y1, slot.role
    # 時刻は見出しの群に移した。墨の面は詳細の群から下だけを覆う。
    meta = plan.slot("meta")
    assert meta is not None
    assert meta.box[1] < y1


def test_the_date_and_the_time_sit_in_the_same_group() -> None:
    """日付と開催時間は見出しの群で 1 続きにする。片方を下端へ離さない。"""
    plan = _plan()
    eyebrow = plan.slot("eyebrow")
    meta = plan.slot("meta")
    title = plan.slot("title")
    assert eyebrow is not None and meta is not None and title is not None
    assert eyebrow.box[1] < meta.box[1] < title.box[1]
    assert meta.box[1] - (eyebrow.box[1] + eyebrow.box[3]) == design.GAP_AFTER_EYEBROW
    assert title.box[1] - (meta.box[1] + meta.box[3]) == design.GAP_AFTER_META


@pytest.mark.parametrize("template_id", list(TemplateId))
def test_the_time_is_larger_than_the_date_and_smaller_than_the_title(
    template_id: TemplateId,
) -> None:
    plan = _plan(template_id)
    eyebrow = plan.slot("eyebrow")
    meta = plan.slot("meta")
    title = plan.slot("title")
    assert eyebrow is not None and meta is not None and title is not None
    assert title.size > meta.size > eyebrow.size


def test_a_chosen_title_colour_reaches_the_slot() -> None:
    plan = _plan(title_color=(255, 255, 255))
    title = plan.slot("title")
    assert title is not None
    assert title.color == (255, 255, 255)
    assert plan.title_color == (255, 255, 255)


def test_the_title_colour_is_automatic_by_default() -> None:
    """未指定は「自動」。墨を仮に置き、描画時に地の色から決める。"""
    plan = _plan()
    title = plan.slot("title")
    assert title is not None
    assert plan.title_color is None
    assert title.color == plan.colors.ink


def test_the_quiet_tile_has_no_plate() -> None:
    assert _plan(TemplateId.STYLE_1_BAR_STYLISH).surface is None


def test_a_slot_area_is_a_rectangle_and_the_box_is_not() -> None:
    """box は (x, y, 幅, 高さ)。矩形として比べるのは `area` だけにする。

    高さを下端と取り違えると、詳細のスロットまで見出しの群の内側と判定され、
    帯の文字が写真の地に対して白へ押し上げられる（帯と同化する）。
    """
    plan = _plan(TemplateId.STYLE_2_WARM_EARTH)
    value = plan.slot("fact_value_0")
    title = plan.slot("title")
    assert value is not None and title is not None
    x, y, width, height = value.box
    assert value.area == (x, y, x + width, y + height)
    title_group = poster._group_holding(poster._groups(plan), title.area)
    assert title_group is not None
    assert not poster._inside(value.area, title_group)
    assert poster._inside(value.area, plan.surface or (0, 0, 0, 0))


def test_no_icons_pills_or_panels_are_drawn() -> None:
    """区切りは罫線。クリップアートのアイコンとピルは持たない。"""
    source = inspect.getsource(poster)
    for name in ("_draw_icon", "_draw_rain_pill", "_paint_pop_panel", "ellipse", "polygon"):
        assert name not in source, name


def test_accent_of_a_dark_theme_is_still_readable() -> None:
    """#00F0FF のような明るい差し色も、紙の上では濃さを寄せる。"""
    look = theme_look(None)
    dark = design.colors_for(
        look,
        "paper",
        accent=(0, 240, 255),
    )
    paper = design.colors_for(look, "paper").paper
    assert design.contrast_ratio(
        design.relative_luminance(*dark.accent),
        design.relative_luminance(*paper),
    ) >= design.MIN_CONTRAST


def test_neon_yellow_is_darkened_for_a_light_paper() -> None:
    colors = design.colors_for(theme_look(None), "paper", accent=(255, 230, 0))
    assert design.contrast_ratio(
        design.relative_luminance(*colors.accent),
        design.relative_luminance(*colors.paper),
    ) >= design.MIN_CONTRAST
    # 色相は捨てない。黒にしてしまわない。
    assert colors.accent != (0, 0, 0)


def test_the_ink_surface_swaps_the_ink_and_the_paper() -> None:
    colors = design.colors_for(theme_look(None), "ink")
    assert design.contrast_ratio(
        design.relative_luminance(*colors.on_surface),
        design.relative_luminance(*colors.surface),
    ) >= design.MIN_CONTRAST


def test_the_surface_steps_are_ordered_by_darkness() -> None:
    look = theme_look(None)
    paper = design.colors_for(look, "paper").surface
    band = design.colors_for(look, "band").surface
    ink = design.colors_for(look, "ink").surface
    assert design.relative_luminance(*ink) < design.relative_luminance(*band)
    assert design.relative_luminance(*band) < design.relative_luminance(*paper)


def test_an_iso_date_is_written_in_japanese() -> None:
    """`2026-11-14` のまま焼くと、細いハイフンが並ぶだけで日付に読めない。

    呼び出し側が整形して渡すのが本来だが、描画の側でも ISO を見たら直す。
    """
    assert poster.display_date("2026-11-14") == "2026年11月14日（土）"
    assert poster.display_date("2027-01-01") == "2027年1月1日（金）"


def test_a_poster_plan_never_prints_an_iso_date() -> None:
    variant = design.variant_for(TemplateId.STYLE_1_BAR_STYLISH)
    colors = design.colors_for(theme_look(None), variant.surface)
    plan = build_poster_plan(
        variant=variant,
        colors=colors,
        stack=stack_for(TextLayout.CLASSIC),
        title_lines=["秋のゆるごはん会"],
        title_size=163,
        title_width=800,
        title_hanging=False,
        event_date="2026-11-14",
        event_time="18:30〜21:00",
        facts=FACTS,
        note="雨天決行",
        title_color=None,
    )
    eyebrow = plan.slot("eyebrow")
    assert eyebrow is not None
    assert eyebrow.text == "2026年11月14日（土）"


def test_a_date_that_is_not_iso_is_left_alone() -> None:
    """整形済みの文字列・実在しない日付は、勝手に書き換えない。"""
    assert poster.display_date("2026年11月15日(日)") == "2026年11月15日(日)"
    assert poster.display_date("2026-02-30") == "2026-02-30"
