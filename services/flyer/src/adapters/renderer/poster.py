"""紙面の組み立て（純関数）と、その描画。

`build_poster_plan` は文字・大きさ・位置・色だけを決めたデータを返す。フォントも
画像も触らないので、目盛りと縦のリズムを画像なしで検証できる。`draw_poster` が
その計画を 1 枚のキャンバスへ写す。

紙面は「見出しの群」と「詳細の群」の 2 つでできている。標準の配置は、見出しを
上端に、詳細を下端に置き、写真の主役を真ん中へ残す。文字サイズも縦位置も
`design` の目盛りからしか選ばない。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from PIL import Image, ImageDraw, ImageFont

from src.adapters.renderer import design
from src.adapters.renderer.layout_calculator import (
    TitleFit,
    average_rgb,
    blend_rgb,
    contrast_ratio,
    fit_to_scale,
    line_width,
    load_font,
    relative_luminance,
    veil_alpha,
)
from src.adapters.renderer.layouts import StackAnchor, StackSpec
from src.domain.models import FlyerGenerationRequest, TemplateId
from src.domain.semantic_theme import RGB, parse_hex

SlotAlign = Literal["center", "left", "right"]

#: 面を持つ変奏で、面の外側へ広げる余白。
PLATE_PADDING = 56
#: 詳細の群だけに敷く帯の余白。
BAND_PADDING = 24
#: 見出しの群と詳細の群のあいだの最小の空き。
BETWEEN_GROUPS = design.GAP_AFTER_RULE
#: これ以上あいたら別の群とみなす（保護の範囲を決める）。
GROUP_GAP = 40


@dataclass(frozen=True)
class PosterSlot:
    """1 つの文字スロット。位置は 8px の目盛りに載っている。"""

    role: str
    text: str
    size: int
    #: (x, y, width, height)。height は行送り × 行数。
    box: tuple[int, int, int, int]
    color: RGB
    align: SlotAlign
    #: 行送り。1 行目の上端から次の行の上端まで。
    leading: int
    letter_spacing: int = 0

    @property
    def area(self) -> tuple[int, int, int, int]:
        """(x1, y1, x2, y2)。`box` は (x, y, 幅, 高さ) なので取り違えない。"""
        x, y, width, height = self.box
        return (x, y, x + width, y + height)


@dataclass(frozen=True)
class PosterRule:
    """罫線。区切りは箱でも影でもなく、線で示す。"""

    role: str
    box: tuple[int, int, int, int]
    color: RGB

    @property
    def area(self) -> tuple[int, int, int, int]:
        """(x1, y1, x2, y2)。`box` は (x, y, 幅, 高さ) なので取り違えない。"""
        x, y, width, height = self.box
        return (x, y, x + width, y + height)


@dataclass(frozen=True)
class PosterPlan:
    """1 枚分の紙面。描画に必要な情報だけを持つ。"""

    template_id: TemplateId
    colors: design.PosterColors
    slots: tuple[PosterSlot, ...]
    rules: tuple[PosterRule, ...]
    #: タイトルに選ばれた色。`None` は「自動」で、描画時に地の色から決める。
    title_color: RGB | None
    #: 文字が載る面 (x1, y1, x2, y2)。`None` なら背景のまま。
    surface: tuple[int, int, int, int] | None
    #: 文字が載りうる縦範囲 (上端, 下端)。
    block: tuple[int, int]
    title_size: int
    title_line_count: int
    title_width: int
    title_height: int
    title_hanging: bool

    def slot(self, role: str) -> PosterSlot | None:
        for item in self.slots:
            if item.role == role:
                return item
        return None

    @property
    def variant(self) -> design.PosterVariant:
        return design.variant_for(self.template_id)


@dataclass(frozen=True)
class DrawReport:
    """描画の結果と、実際に使った保護の記録。"""

    image: Image.Image
    #: 紙のベールを敷いた最大の不透明度。敷かなければ None。
    veil_alpha: float | None
    #: 面を敷いた不透明度。面が無ければ None。
    surface_alpha: float | None
    #: タイトルが載った地とのコントラスト比。
    title_contrast: float
    #: 実際に描いたタイトルの色。
    title_color: RGB
    #: 選ばれた色から変えたか（背景に対して読みにくかったとき）。
    title_color_adjusted: bool


def _fact_row_height(style: design.FactsStyle) -> int:
    label = design.line_height(design.FACT_LABEL_SIZE, design.LABEL_LINE_RATIO)
    if style == "two_column":
        return 40
    if style == "hero":
        value = design.line_height(design.FACT_VALUE_HERO_SIZE, design.LABEL_LINE_RATIO)
        return label + design.FACT_LABEL_GAP + value
    return label + design.FACT_LABEL_GAP + design.line_height(
        design.FACT_VALUE_SIZE, design.LABEL_LINE_RATIO
    )


def _paper_colors(colors: design.PosterColors) -> tuple[RGB, RGB, RGB]:
    """紙の上の文字色 (主文字, 補助文字, 差し色)。"""
    return (colors.ink, colors.ink_sub, colors.accent)


def _body_colors(
    variant: design.PosterVariant,
    colors: design.PosterColors,
) -> tuple[RGB, RGB, RGB]:
    """詳細の群の文字色。墨の面に載るときだけ明暗を入れ替える。"""
    if variant.surface == "ink":
        return (
            colors.on_surface,
            blend_rgb(colors.surface, colors.on_surface, 0.82),
            colors.on_surface_accent,
        )
    return (colors.ink, colors.ink_sub, colors.accent)


def _hairline(
    variant: design.PosterVariant,
    colors: design.PosterColors,
) -> RGB:
    """明細を区切る 1px の罫線。文字より弱く、地より強い。"""
    if variant.surface == "ink":
        return blend_rgb(colors.surface, colors.on_surface, 0.28)
    return blend_rgb(colors.paper, colors.ink, 0.24)


def _top_group(
    *,
    variant: design.PosterVariant,
    colors: design.PosterColors,
    y: int,
    date: str,
    time: str,
    title_lines: Sequence[str],
    title_size: int,
    title_color: RGB | None,
) -> tuple[list[PosterSlot], list[PosterRule], int]:
    """日付・時刻・タイトル・罫線。上端からの高さを返す。

    日付と時刻は同じ群に置く。片方を上端、片方を下端へ離すと、いつ開く催しなのかを
    目が 2 往復して読むことになる。時刻は日付より大きく、タイトルより小さい。
    """
    align: SlotAlign = variant.align
    ink, ink_sub, accent = _paper_colors(colors)
    leading = design.line_height(title_size, design.HEADING_LINE_RATIO)
    left, width = design.SIDE_MARGIN, design.CONTENT_WIDTH
    slots: list[PosterSlot] = []
    rules: list[PosterRule] = []

    if date:
        eyebrow = design.line_height(design.EYEBROW_SIZE, design.LABEL_LINE_RATIO)
        slots.append(
            PosterSlot(
                role="eyebrow",
                text=date,
                size=design.EYEBROW_SIZE,
                box=(left, y, width, eyebrow),
                color=accent,
                align=align,
                leading=eyebrow,
                letter_spacing=design.LABEL_TRACKING,
            )
        )
        y += eyebrow + design.GAP_AFTER_EYEBROW

    if time:
        meta = design.line_height(design.META_SIZE, design.LABEL_LINE_RATIO)
        slots.append(
            PosterSlot(
                role="meta",
                text=time,
                size=design.META_SIZE,
                box=(left, y, width, meta),
                color=ink_sub,
                align=align,
                leading=meta,
            )
        )
        y += meta + design.GAP_AFTER_META

    height = leading * len(title_lines)
    slots.append(
        PosterSlot(
            role="title",
            text="\n".join(title_lines),
            size=title_size,
            box=(left, y, width, height),
            # 「自動」は墨を仮に置き、描画時に地の色から決め直す。
            color=title_color if title_color is not None else ink,
            align=align,
            leading=leading,
        )
    )
    y += height + design.GAP_AFTER_TITLE

    rule_width = variant.rule_width
    rule_x = left + max(0, (width - rule_width) // 2) if align == "center" else left
    rules.append(
        PosterRule(
            role="headline",
            box=(rule_x, y, rule_width, variant.rule_thickness),
            color=accent,
        )
    )
    # 罫線は 1 本ぶんの帯（8px）に収め、次のスロットを目盛りへ戻す。
    y += design.BASELINE
    return slots, rules, y


def _body_group(
    *,
    variant: design.PosterVariant,
    colors: design.PosterColors,
    y: int,
    facts: Sequence[tuple[str, str]],
    note: str,
) -> tuple[list[PosterSlot], list[PosterRule], int]:
    """明細と雨天の扱い。先頭からの高さを返す。

    時刻はここに置かない。日付と同じ群（`_top_group`）へまとめ、見出し側で
    「いつ開くか」を 1 続きで読ませる。
    """
    align: SlotAlign = variant.align
    ink, ink_sub, _ = _body_colors(variant, colors)
    hairline = _hairline(variant, colors)
    left, width = design.SIDE_MARGIN, design.CONTENT_WIDTH
    slots: list[PosterSlot] = []
    rules: list[PosterRule] = []

    rows = [row for row in facts if row[0]]
    row_height = _fact_row_height(variant.facts)
    label = design.line_height(design.FACT_LABEL_SIZE, design.LABEL_LINE_RATIO)
    value_size = (
        design.FACT_VALUE_HERO_SIZE if variant.facts == "hero" else design.FACT_VALUE_SIZE
    )
    value = design.line_height(value_size, design.LABEL_LINE_RATIO)
    for index, (fact_label, fact_value) in enumerate(rows):
        if variant.facts == "two_column":
            label_box = (left, y + design.BASELINE, 240, label)
            value_box = (left + 240, y, width - 240, value)
            value_align: SlotAlign = "right"
        else:
            label_box = (left, y, width, label)
            value_box = (left, y + label + design.FACT_LABEL_GAP, width, value)
            value_align = align
        slots.append(
            PosterSlot(
                role=f"fact_label_{index}",
                text=fact_label,
                size=design.FACT_LABEL_SIZE,
                box=label_box,
                color=ink_sub,
                align=align,
                leading=label,
            )
        )
        slots.append(
            PosterSlot(
                role=f"fact_value_{index}",
                text=fact_value,
                size=value_size,
                box=value_box,
                color=ink,
                align=value_align,
                leading=value,
            )
        )
        y += row_height
        if index < len(rows) - 1:
            rules.append(
                PosterRule(
                    role=f"fact_rule_{index}",
                    box=(left, y + design.FACT_RULE_GAP, width, 1),
                    color=hairline,
                )
            )
            y += design.FACT_RULE_GAP * 2

    if rows:
        y += design.GAP_AFTER_FACTS
    if note:
        note_leading = design.line_height(design.NOTE_SIZE, design.LABEL_LINE_RATIO)
        slots.append(
            PosterSlot(
                role="note",
                text=note,
                size=design.NOTE_SIZE,
                box=(left, y, width, note_leading),
                color=ink_sub,
                align=align,
                leading=note_leading,
            )
        )
        y += note_leading
    return slots, rules, y


def _floor(value: int) -> int:
    """8px の目盛りへ切り下げる。"""
    return (value // design.BASELINE) * design.BASELINE


def _origins(anchor: StackAnchor, start: int, top_h: int, body_h: int) -> tuple[int, int]:
    """見出しの群と詳細の群の上端。"""
    gap = BETWEEN_GROUPS if body_h else 0
    total = top_h + gap + body_h
    if anchor == "split" and body_h:
        top = design.TOP_SAFE
        body = design.BOTTOM_SAFE - body_h
        if body - top < top_h + BETWEEN_GROUPS:
            # 見出しが大きすぎるときは分割をやめ、続けて積む。
            body = top + top_h + BETWEEN_GROUPS
    elif anchor == "bottom":
        top = _floor(design.BOTTOM_SAFE - total)
        body = top + top_h + gap
    elif anchor == "center":
        top = _floor((design.CANVAS_HEIGHT - total) // 2)
        top = min(top, design.BOTTOM_SAFE - total)
        body = top + top_h + gap
    else:
        top = start
        body = top + top_h + gap
    top = max(design.TOP_SAFE, _floor(top))
    return top, body


def build_poster_plan(
    *,
    variant: design.PosterVariant,
    colors: design.PosterColors,
    stack: StackSpec,
    title_lines: Sequence[str],
    title_size: int,
    title_width: int,
    title_hanging: bool,
    event_date: str,
    event_time: str,
    facts: Sequence[tuple[str, str]],
    note: str,
    title_color: RGB | None = None,
) -> PosterPlan:
    """スロットの文字・大きさ・位置・色を決める。画像もフォントも触らない。

    差し色を使うのは eyebrow と見出し下の罫線だけ。大きな文字には使わない。
    `title_color` が None のときは墨を仮に置き、実際の地の色を見て描画時に決める。
    """
    top_slots, top_rules, top_h = _top_group(
        variant=variant,
        colors=colors,
        y=0,
        date=event_date,
        time=event_time,
        title_lines=title_lines,
        title_size=title_size,
        title_color=title_color,
    )
    body_slots, body_rules, body_h = _body_group(
        variant=variant,
        colors=colors,
        y=0,
        facts=facts,
        note=note,
    )
    top_origin, body_origin = _origins(stack.anchor, stack.start, top_h, body_h)

    def shift_slots(items: list[PosterSlot], dy: int) -> list[PosterSlot]:
        return [
            PosterSlot(
                role=item.role,
                text=item.text,
                size=item.size,
                box=(item.box[0], item.box[1] + dy, item.box[2], item.box[3]),
                color=item.color,
                align=item.align,
                leading=item.leading,
                letter_spacing=item.letter_spacing,
            )
            for item in items
        ]

    def shift_rules(items: list[PosterRule], dy: int) -> list[PosterRule]:
        return [
            PosterRule(
                role=item.role,
                box=(item.box[0], item.box[1] + dy, item.box[2], item.box[3]),
                color=item.color,
            )
            for item in items
        ]

    slots = shift_slots(top_slots, top_origin) + shift_slots(body_slots, body_origin)
    rules = shift_rules(top_rules, top_origin) + shift_rules(body_rules, body_origin)

    # 面は詳細の群の裏にだけ敷く。見出しは写真の上に残し、写真を潰さない。
    plate_top = body_origin if body_h else top_origin
    block_bottom = body_origin + body_h if body_h else top_origin + top_h
    surface: tuple[int, int, int, int] | None = None
    if variant.surface == "band":
        surface = (
            0,
            max(0, plate_top - BAND_PADDING),
            design.CANVAS_WIDTH,
            min(design.CANVAS_HEIGHT, block_bottom + BAND_PADDING),
        )
    elif variant.surface == "ink":
        # 墨の面は下端まで伸ばす。紙の下側が濃い塊になる。
        surface = (
            0,
            max(0, plate_top - PLATE_PADDING),
            design.CANVAS_WIDTH,
            design.CANVAS_HEIGHT,
        )

    return PosterPlan(
        template_id=variant.template_id,
        colors=colors,
        slots=tuple(slots),
        rules=tuple(rules),
        title_color=title_color,
        surface=surface,
        block=(top_origin, min(design.CANVAS_HEIGHT, block_bottom)),
        title_size=title_size,
        title_line_count=len(title_lines),
        title_width=title_width,
        title_height=design.line_height(title_size, design.HEADING_LINE_RATIO)
        * len(title_lines),
        title_hanging=title_hanging,
    )


def plan_for_request(
    request: FlyerGenerationRequest,
    *,
    title: TitleFit,
    stack: StackSpec,
    accent: str | None = None,
) -> PosterPlan:
    """依頼から紙面を作る。タイトルは目盛りから選び直さない。

    `accent` はステップ 4 で選ばれた配色の差し色。未指定ならテーマの差し色。
    `title_color` が未指定なら「自動」で、描画時に地の色から決める。
    """
    variant = design.variant_for(request.template_id)
    colors = design.colors_for_theme(
        request.semantic_theme,
        variant.surface,
        parse_hex(accent) if accent else None,
    )
    facts = [("会場", request.location), ("参加費", request.price)]
    if request.capacity:
        facts.append(("定員", request.capacity))
    return build_poster_plan(
        variant=variant,
        colors=colors,
        stack=stack,
        title_lines=title.lines,
        title_size=title.size,
        title_width=title.width,
        title_hanging=title.hanging,
        event_date=request.event_date,
        event_time=request.event_time,
        facts=facts,
        note=request.rain_policy.value,
        title_color=parse_hex(request.title_color) if request.title_color else None,
    )


def _draw_slot(
    draw: ImageDraw.ImageDraw,
    slot: PosterSlot,
    font: ImageFont.FreeTypeFont,
    color: RGB | None = None,
) -> None:
    """1 行ずつ、寄せに従って置く。字間は 1 文字ずつ足す。

    `color` を渡すと、スロットが持つ色の代わりにそれで描く。背景を見て決めた
    タイトル色を反映するために使う。
    """
    fill = color if color is not None else slot.color
    x, y, width, _ = slot.box
    lines = slot.text.split("\n")
    for index, line in enumerate(lines):
        text_w = line_width(draw, line, font, slot.letter_spacing)
        if slot.align == "center":
            origin_x = x + max(0, (width - text_w) // 2)
        elif slot.align == "right":
            origin_x = x + max(0, width - text_w)
        else:
            origin_x = x
        line_y = y + index * slot.leading
        if slot.letter_spacing <= 0:
            draw.text((origin_x, line_y), line, font=font, fill=fill, anchor="lt")
            continue
        cursor = origin_x
        for char in line:
            draw.text((cursor, line_y), char, font=font, fill=fill, anchor="lt")
            cursor += line_width(draw, char, font) + slot.letter_spacing


def _paint_rect(
    canvas: Image.Image,
    box: tuple[int, int, int, int],
    color: RGB,
    alpha: float = 1.0,
) -> Image.Image:
    x1, y1, x2, y2 = box
    x1 = max(0, min(canvas.width, x1))
    x2 = max(0, min(canvas.width, x2))
    y1 = max(0, min(canvas.height, y1))
    y2 = max(0, min(canvas.height, y2))
    if x2 <= x1 or y2 <= y1:
        return canvas
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rectangle(
        (x1, y1, x2, y2),
        fill=(*color, int(round(alpha * 255))),
    )
    return Image.alpha_composite(canvas.convert("RGBA"), overlay)


def _groups(plan: PosterPlan) -> list[tuple[int, int, int, int]]:
    """縦に近いスロットをまとめた矩形。保護の範囲を決めるのに使う。"""
    ordered = sorted(plan.slots, key=lambda slot: slot.box[1])
    boxes: list[tuple[int, int, int, int]] = []
    for slot in ordered:
        x, y, width, height = slot.box
        if boxes and y - boxes[-1][3] <= GROUP_GAP:
            x1, y1, x2, y2 = boxes[-1]
            boxes[-1] = (min(x1, x), y1, max(x2, x + width), max(y2, y + height))
        else:
            boxes.append((x, y, x + width, y + height))
    return [
        (max(0, x1 - 24), max(0, y1 - 16), min(design.CANVAS_WIDTH, x2 + 24), min(design.CANVAS_HEIGHT, y2 + 16))
        for x1, y1, x2, y2 in boxes
    ]


def _inside(box: tuple[int, int, int, int], area: tuple[int, int, int, int]) -> bool:
    """`box` が `area` の内側か。どちらも (x1, y1, x2, y2)。

    `PosterSlot.box` / `PosterRule.box` は (x, y, 幅, 高さ) なので、そのまま
    渡さず `area` を通す。高さを下端と比べると必ず内側と判定されてしまう。
    """
    return box[0] >= area[0] and box[1] >= area[1] and box[2] <= area[2] and box[3] <= area[3]


def _veil_color(plan: PosterPlan) -> RGB:
    """読みやすさのために重ねる色。墨の面の変奏では面の色を使う。"""
    if plan.variant.surface == "ink":
        return plan.colors.surface
    return plan.colors.paper


def _group_holding(
    groups: Sequence[tuple[int, int, int, int]],
    box: tuple[int, int, int, int],
) -> tuple[int, int, int, int] | None:
    """スロットが属する群の矩形。群は互いに重ならない。"""
    for area in groups:
        if _inside(box, area):
            return area
    return None


def resolve_title_color(
    preferred: RGB | None,
    ink: RGB,
    background: RGB,
) -> RGB:
    """タイトルの文字色を、実際に載る地の色から決める。

    `preferred` が None（自動）のときは、墨が 4.5:1 を満たせば墨、満たさなければ
    白を選ぶ。どちらも満たない中間の地では墨のまま返し、呼び出し側が紙のベールで
    地を持ち上げる。選ばれた色は動かさない。読みにくければベールの向きで地の方を
    寄せる（白い紙に白を選んだら、文字ではなく地が暗くなる）。
    """
    if preferred is not None:
        return preferred
    if design.contrast_ratio(
        design.relative_luminance(*ink),
        design.relative_luminance(*background),
    ) >= design.MIN_CONTRAST:
        return ink
    white: RGB = (255, 255, 255)
    if design.contrast_ratio(
        design.relative_luminance(*white),
        design.relative_luminance(*background),
    ) >= design.MIN_CONTRAST:
        return white
    return ink


def _title_veil_color(plan: PosterPlan, title_color: RGB) -> RGB:
    """見出しの群に敷く色。文字が地より明るければ墨、暗ければ紙。"""
    paper = plan.colors.paper
    if design.relative_luminance(*title_color) > design.relative_luminance(*paper):
        return design.surface_for(paper, "ink")
    return paper


def draw_poster(
    canvas: Image.Image,
    plan: PosterPlan,
    font_path: str,
) -> DrawReport:
    """計画をキャンバスへ写す。面 → ベール → 罫線 → 文字の順。

    見出しの群だけは順序が違う。地の色を測ってタイトル色を決め、その色に対して
    ベールの向きと濃さを決めてから敷く。逆にすると、白いタイトルの上に紙色を
    塗ってしまい、選んだ色が読めなくなる。
    """
    working = canvas.convert("RGBA")
    veil_color = _veil_color(plan)
    ink, _, _ = _paper_colors(plan.colors)
    body_ink, _, _ = _body_colors(plan.variant, plan.colors)
    final: dict[str, RGB] = {}

    # 面は写真を透かして敷く。透かすほど地が動くので、面の上の文字色は
    # 面を敷いたあとの実色から決め直す（下の `surface_ground`）。
    surface_alpha: float | None = None
    surface_ground: RGB | None = None
    if plan.surface is not None:
        surface_alpha = design.SURFACE_ALPHA[plan.variant.surface]
        needed = veil_alpha(
            average_rgb(working, plan.surface),
            plan.colors.surface,
            body_ink,
        )
        if needed is not None:
            surface_alpha = max(surface_alpha, needed)
        working = _paint_rect(
            working,
            plan.surface,
            plan.colors.surface,
            surface_alpha,
        )
        surface_ground = average_rgb(working, plan.surface)
        for slot in plan.slots:
            if _inside(slot.area, plan.surface):
                final[slot.role] = design.ensure_contrast(slot.color, surface_ground)

    groups = _groups(plan)
    title = plan.slot("title")
    title_group = _group_holding(groups, title.area) if title is not None else None

    strongest: float | None = None
    for box in groups:
        if plan.surface is not None and _inside(box, plan.surface):
            continue
        if box == title_group:
            continue
        mean = average_rgb(working, box)
        alpha = veil_alpha(mean, veil_color, ink)
        if alpha is None:
            continue
        working = _paint_rect(working, box, veil_color, alpha)
        strongest = max(strongest or 0.0, alpha)

    title_color = ink
    behind: tuple[int, int, int, int] | None = None
    adjusted = False
    if title_group is not None:
        title_color = resolve_title_color(
            plan.title_color,
            ink,
            average_rgb(working, title_group),
        )
        paint = _title_veil_color(plan, title_color)
        alpha = veil_alpha(average_rgb(working, title_group), paint, title_color)
        if alpha is not None:
            working = _paint_rect(working, title_group, paint, alpha)
            strongest = max(strongest or 0.0, alpha)
        behind = title_group
        # ベール後の地に対して、見出しの群の文字を読める濃さへ寄せる。
        ground = average_rgb(working, behind)
        for slot in plan.slots:
            if _inside(slot.area, behind):
                final[slot.role] = design.ensure_contrast(slot.color, ground)
        title_color = design.ensure_contrast(title_color, ground)
        final["title"] = title_color
        adjusted = plan.title_color is not None and title_color != plan.title_color

    title_contrast = 1.0
    if title is not None:
        x, y, width, height = title.box
        mean = average_rgb(working, (x, y, x + width, y + height))
        title_contrast = contrast_ratio(
            relative_luminance(*title_color),
            relative_luminance(*mean),
        )

    draw = ImageDraw.Draw(working)
    for rule in plan.rules:
        x, y, width, thickness = rule.box
        color = rule.color
        if surface_ground is not None and plan.surface is not None:
            if _inside(rule.area, plan.surface):
                # 面の上の罫線は 4.5:1 を狙わない。文字より弱く、地より強く残す。
                color = design.blend_rgb(surface_ground, body_ink, 0.24)
        if behind is not None and _inside(rule.area, behind):
            color = design.ensure_contrast(color, average_rgb(working, behind))
        draw.rectangle((x, y, x + width, y + thickness), fill=color)

    for slot in plan.slots:
        font = load_font(font_path, slot.size)
        _draw_slot(draw, slot, font, final.get(slot.role))
    return DrawReport(
        image=working.convert("RGB"),
        veil_alpha=strongest,
        surface_alpha=surface_alpha,
        title_contrast=title_contrast,
        title_color=title_color,
        title_color_adjusted=adjusted,
    )


def measure_contrast(plan: PosterPlan, canvas: Image.Image) -> float:
    """紙面の文字色と、実際に載った地のコントラスト。"""
    title = plan.slot("title")
    if title is None:
        return 1.0
    x, y, width, height = title.box
    mean = average_rgb(canvas, (x, y, x + width, y + height))
    return contrast_ratio(
        relative_luminance(*title.color),
        relative_luminance(*mean),
    )


__all__ = [
    "DrawReport",
    "PosterPlan",
    "PosterRule",
    "PosterSlot",
    "build_poster_plan",
    "draw_poster",
    "fit_to_scale",
    "measure_contrast",
    "plan_for_request",
    "resolve_title_color",
]
