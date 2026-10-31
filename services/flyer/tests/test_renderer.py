"""決定論的レンダラーの幾何・コントラスト検証。"""

from __future__ import annotations

import inspect
import random
from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from src.adapters.candidate_source.paper_ground import render_paper
from src.adapters.renderer import design, layout_calculator, poster
from src.adapters.renderer.layout_calculator import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    HIGH_FREQUENCY_EDGE_VARIANCE,
    average_rgb,
    blend_rgb,
    cell_samples,
    choose_backdrop,
    contrast_ratio,
    edge_variance,
    fit_to_scale,
    hex_to_rgb,
    line_width,
    measure_text_block,
    relative_luminance,
    requires_contrast_protection,
    veil_alpha,
    worst_case_contrast,
)
from src.adapters.renderer.layouts import stack_for
from src.adapters.renderer.pillow_renderer import PillowFlyerRenderer
from src.domain.exceptions import RenderingError
from src.domain.models import (
    FlyerGenerationRequest,
    LLMGenerationContext,
    SemanticTheme,
    TemplateId,
    TextLayout,
)
from tests.support import make_context, make_request


def _png(color: tuple[int, int, int], size: tuple[int, int] = (64, 64)) -> bytes:
    image = Image.new("RGB", size, color)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _noise_png() -> bytes:
    rng = random.Random(1)
    small = Image.new("RGB", (54, 96))
    small.putdata(
        [
            (rng.randrange(256), rng.randrange(256), rng.randrange(256))
            for _ in range(54 * 96)
        ]
    )
    image = small.resize((CANVAS_WIDTH, CANVAS_HEIGHT), Image.Resampling.NEAREST)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _scratch_draw() -> ImageDraw.ImageDraw:
    return ImageDraw.Draw(Image.new("RGB", (8, 8)))


def _ink_coverage(image: Image.Image, background: tuple[int, int, int]) -> float:
    """背景から十分に離れた画素の割合。墨の被覆率の代わりに使う。"""
    thumbnail = image.resize((108, 152)).convert("RGB")
    pixels = list(thumbnail.getdata())
    background_luminance = relative_luminance(*background)
    dark = sum(
        1
        for pixel in pixels
        if abs(relative_luminance(*pixel) - background_luminance) > 0.18
    )
    return dark / len(pixels)


def test_relative_luminance_and_contrast_ratio() -> None:
    assert relative_luminance(0, 0, 0) == pytest.approx(0.0)
    assert relative_luminance(1, 1, 1) == pytest.approx(1.0)
    assert relative_luminance(255, 255, 255) == pytest.approx(1.0)
    assert contrast_ratio(1.0, 0.0) == pytest.approx(21.0)
    assert requires_contrast_protection(4.49)
    assert not requires_contrast_protection(4.5)
    channel = 118 / 255
    linear = ((channel + 0.055) / 1.055) ** 2.4
    assert relative_luminance(channel, channel, channel) == pytest.approx(linear)
    assert contrast_ratio(1.0, linear) == pytest.approx((1.0 + 0.05) / (linear + 0.05))


def test_backdrop_is_required_only_when_contrast_is_short() -> None:
    assert choose_backdrop((0, 0, 0), (255, 255, 255)) is None
    decision = choose_backdrop((255, 255, 255), (255, 255, 255))
    assert decision is not None
    pad, alpha = decision
    assert pad == (0, 0, 0)
    blended = blend_rgb((255, 255, 255), pad, alpha)
    achieved = contrast_ratio(relative_luminance(255, 255, 255), relative_luminance(*blended))
    assert achieved >= 4.5
    previous = blend_rgb((255, 255, 255), pad, 0.5)
    previous_ratio = contrast_ratio(
        relative_luminance(255, 255, 255),
        relative_luminance(*previous),
    )
    assert previous_ratio < 4.5
    assert alpha == 0.65


def test_veil_reaches_readability_with_paper_colour() -> None:
    """黒い帯ではなく、紙の色を薄く敷いて読みやすくする。"""
    assert veil_alpha((250, 250, 250), (250, 250, 250), (31, 35, 40)) is None
    alpha = veil_alpha((120, 120, 140), (246, 247, 249), (31, 35, 40))
    assert alpha is not None
    assert 0.2 <= alpha <= 1.0
    blended = blend_rgb((120, 120, 140), (246, 247, 249), alpha)
    assert contrast_ratio(
        relative_luminance(31, 35, 40),
        relative_luminance(*blended),
    ) >= 4.5


def test_edge_variance_separates_flat_color_from_noise() -> None:
    flat = Image.new("RGB", (80, 80), (20, 20, 20))
    rng = random.Random(0)
    noisy = Image.new("RGB", (80, 80))
    noisy.putdata([(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(80 * 80)])
    assert edge_variance(flat) < HIGH_FREQUENCY_EDGE_VARIANCE
    assert edge_variance(noisy) >= HIGH_FREQUENCY_EDGE_VARIANCE


@pytest.mark.parametrize("title", ["JAZZ", "あ" * 40, "焚火とシチューを囲む夕べ"])
def test_fit_to_scale_keeps_titles_inside_the_content_box(title: str) -> None:
    renderer = PillowFlyerRenderer()
    font_path = renderer.font_path_for(TemplateId.STYLE_1_BAR_STYLISH)
    draw = _scratch_draw()
    fit = fit_to_scale(title, font_path, draw)
    assert design.is_scale_step(fit.size)
    assert fit.size in design.TITLE_STEPS
    assert len(fit.lines) <= design.TITLE_MAX_LINES
    assert fit.width <= design.CONTENT_WIDTH
    assert fit.height <= design.TITLE_MAX_HEIGHT
    assert "".join(fit.lines) == title.replace(" ", "")


def test_larger_space_allows_a_larger_step() -> None:
    renderer = PillowFlyerRenderer()
    font_path = renderer.font_path_for(TemplateId.STYLE_1_BAR_STYLISH)
    draw = _scratch_draw()
    narrow = fit_to_scale("焚火とシチューを囲む夕べ", font_path, draw, max_width=420)
    wide = fit_to_scale("焚火とシチューを囲む夕べ", font_path, draw)
    assert wide.size > narrow.size


def test_title_breaks_at_a_meaning_boundary_not_one_character() -> None:
    renderer = PillowFlyerRenderer()
    font_path = renderer.font_path_for(TemplateId.STYLE_1_BAR_STYLISH)
    draw = _scratch_draw()
    fit = fit_to_scale(
        "焚火とシチューを囲む夕べ",
        font_path,
        draw,
        steps=(66,),
        max_width=600,
    )
    assert len(fit.lines) == 2
    assert all(len(line) >= 2 for line in fit.lines), fit.lines
    assert fit.lines[-1] != "べ"


@pytest.mark.parametrize("max_height", [design.TITLE_MAX_HEIGHT, 440])
def test_title_drops_a_step_instead_of_cutting_inside_a_word(max_height: int) -> None:
    """「川辺の焚き火ナイト」は 1 段下げて「川辺の / 焚き火ナイト」で組む。

    163px でも「川辺の焚 / き火ナイト」なら幅に収まるが、語の途中で折るより
    130px に落として意味の切れ目で分けるほうが読みやすい。
    """
    renderer = PillowFlyerRenderer()
    font_path = renderer.font_path_for(TemplateId.STYLE_1_BAR_STYLISH)
    fit = fit_to_scale(
        "川辺の焚き火ナイト",
        font_path,
        _scratch_draw(),
        max_height=max_height,
    )
    assert fit.lines == ["川辺の", "焚き火ナイト"]
    assert fit.size == 130
    assert fit.width <= design.CONTENT_WIDTH
    assert fit.height <= max_height


def test_short_title_stays_on_one_line_with_tracking() -> None:
    renderer = PillowFlyerRenderer()
    font_path = renderer.font_path_for(TemplateId.STYLE_1_BAR_STYLISH)
    fit = fit_to_scale("ジャズの夜", font_path, _scratch_draw())
    assert fit.lines == ["ジャズの夜"]
    assert fit.letter_spacing == design.SHORT_TITLE_TRACKING
    assert fit.hanging is False


def test_hanging_is_off_for_centred_paper() -> None:
    """中央寄せの紙面ではぶら下げない。右端へ寄せると中央から外れる。"""
    renderer = PillowFlyerRenderer()
    font_path = renderer.font_path_for(TemplateId.STYLE_1_BAR_STYLISH)
    fit = fit_to_scale(
        "焚火とシチューを囲む夕べ",
        font_path,
        _scratch_draw(),
        steps=(53,),
        max_width=420,
        allow_hanging=False,
    )
    assert fit.hanging is False


@pytest.mark.parametrize("template_id", list(TemplateId))
def test_solid_background_renders_portrait_canvas(template_id: TemplateId) -> None:
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        _png((240, 240, 240)),
        make_request("ジャズの夜", template_id),
        make_context(template_id),
    )
    image = Image.open(BytesIO(data))
    assert image.size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    assert image.mode == "RGB"
    assert data[:2] == b"\xff\xd8"
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.contrast_ratio >= 4.5
    assert metadata.title_block_width <= design.CONTENT_WIDTH
    assert metadata.title_block_height <= design.TITLE_MAX_HEIGHT
    assert metadata.title_line_count <= design.TITLE_MAX_LINES
    assert metadata.title_font_size in design.TYPE_SCALE


@pytest.mark.parametrize("title", ["JAZZ", "あ" * 40])
def test_extreme_titles_render_inside_the_page(title: str) -> None:
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        _png((250, 220, 40)),
        make_request(title, TemplateId.STYLE_3_VIBRANT_POP),
        make_context(TemplateId.STYLE_3_VIBRANT_POP),
    )
    assert Image.open(BytesIO(data)).size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.title_line_count <= design.TITLE_MAX_LINES
    assert metadata.title_block_width <= design.CONTENT_WIDTH
    assert metadata.contrast_ratio >= 4.5


def test_high_frequency_background_is_veiled_until_readable() -> None:
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        _noise_png(),
        make_request("JAZZ", TemplateId.STYLE_1_BAR_STYLISH),
        make_context(TemplateId.STYLE_1_BAR_STYLISH),
    )
    assert Image.open(BytesIO(data)).size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.contrast_ratio >= 4.5


def test_invalid_background_raises_rendering_error() -> None:
    renderer = PillowFlyerRenderer()
    with pytest.raises(RenderingError):
        renderer.render_flyer(
            b"not-an-image",
            make_request(),
            make_context(),
        )


def test_renderer_modules_do_not_reference_external_apis() -> None:
    for module in (layout_calculator, poster, design):
        source = inspect.getsource(module).lower()
        assert "openai" not in source
        assert "httpx" not in source
        assert "requests" not in source


@pytest.mark.parametrize("template_id", list(TemplateId))
@pytest.mark.parametrize("layout_id", list(TextLayout))
def test_every_layout_renders_and_records_its_preset(
    template_id: TemplateId,
    layout_id: TextLayout,
) -> None:
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        _png((240, 240, 240)),
        make_request(template_id=template_id, layout_id=layout_id),
        make_context(template_id),
    )
    assert Image.open(BytesIO(data)).size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.layout_id == layout_id
    assert metadata.title_block_height <= stack_for(layout_id).title_height
    assert metadata.contrast_ratio >= 4.5


def test_top_stack_leaves_the_lower_band_empty() -> None:
    """「上にまとめる」は下半分を空ける。背景がそのまま残ることを画素で確かめる。"""
    renderer = PillowFlyerRenderer()
    template_id = TemplateId.STYLE_1_BAR_STYLISH
    data = renderer.render_flyer(
        _png((240, 240, 240)),
        make_request(template_id=template_id, layout_id=TextLayout.TOP_STACK),
        make_context(template_id),
    )
    image = Image.open(BytesIO(data)).convert("RGB")
    top = stack_for(TextLayout.TOP_STACK)
    band_top = top.start + 720
    mean = average_rgb(image, (96, band_top, CANVAS_WIDTH - 96, CANVAS_HEIGHT - 96))
    assert all(abs(channel - 240) <= 8 for channel in mean), mean


def _plan_for(
    request: object,
    context: object,
) -> poster.PosterPlan:
    """レンダラーと同じ手順で計画を組む。帯の座標をテストから引くために使う。"""

    assert isinstance(request, FlyerGenerationRequest)
    assert isinstance(context, LLMGenerationContext)
    variant = design.variant_for(request.template_id)
    stack = stack_for(request.layout_id)
    title = fit_to_scale(
        request.title,
        PillowFlyerRenderer().font_path_for(request.template_id),
        _scratch_draw(),
        max_width=design.CONTENT_WIDTH,
        max_height=stack.title_height,
        allow_hanging=variant.align == "left",
    )
    return poster.plan_for_request(
        request,
        title=title,
        stack=stack,
        accent=context.suggested_accent_color,
    )


def _dark_pixels(image: Image.Image, box: tuple[int, int, int, int]) -> int:
    """矩形の中で、帯の地に対して十分に暗い画素の数。"""
    return sum(
        1
        for y in range(box[1], box[3])
        for x in range(box[0], box[2])
        if relative_luminance(*image.getpixel((x, y))) < 0.2
    )


def test_detail_text_stays_dark_on_the_translucent_band() -> None:
    """帯の文字色は、写真の地ではなく帯の色に対して決める。

    暗い写真の平均色で決めると墨が白へ押し上げられ、明るい帯と同化する。
    """
    request = make_request(template_id=TemplateId.STYLE_2_WARM_EARTH)
    context = make_context(TemplateId.STYLE_2_WARM_EARTH)
    plan = _plan_for(request, context)
    assert plan.surface is not None
    data = PillowFlyerRenderer().render_flyer(_png((20, 20, 20)), request, context)
    image = Image.open(BytesIO(data)).convert("RGB")
    x1, y1, x2, y2 = plan.surface
    band = (x1 + 96, y1 + 16, x2 - 96, y2 - 16)
    assert _dark_pixels(image, band) > 500, average_rgb(image, band)


def test_the_band_lets_the_background_through() -> None:
    """帯は写真を透かす。地が変われば帯の色も変わる。"""
    request = make_request(template_id=TemplateId.STYLE_2_WARM_EARTH)
    context = make_context(TemplateId.STYLE_2_WARM_EARTH)
    plan = _plan_for(request, context)
    assert plan.surface is not None
    renderer = PillowFlyerRenderer()
    dark = Image.open(
        BytesIO(renderer.render_flyer(_png((20, 20, 20)), request, context))
    ).convert("RGB")
    light = Image.open(
        BytesIO(renderer.render_flyer(_png((250, 250, 250)), request, context))
    ).convert("RGB")
    mean_dark = average_rgb(dark, plan.surface)
    mean_light = average_rgb(light, plan.surface)
    assert sum(mean_light) - sum(mean_dark) > 60, (mean_dark, mean_light)


@pytest.mark.parametrize(
    "template_id",
    [TemplateId.STYLE_2_WARM_EARTH, TemplateId.STYLE_3_VIBRANT_POP],
)
def test_the_surface_alpha_is_reported(template_id: TemplateId) -> None:
    """面の不透明度は描画の実値。1.0 で塗り潰したことにしない。"""
    renderer = PillowFlyerRenderer()
    renderer.render_flyer(
        _png((250, 250, 250)),
        make_request(template_id=template_id),
        make_context(template_id),
    )
    metadata = renderer.last_metadata
    assert metadata is not None
    variant = design.variant_for(template_id)
    assert metadata.overlay_alpha == pytest.approx(design.SURFACE_ALPHA[variant.surface])


def test_layout_change_alters_the_output() -> None:
    renderer = PillowFlyerRenderer()
    request = make_request()
    context = make_context()
    classic = renderer.render_flyer(_png((240, 240, 240)), request, context)
    top = renderer.render_flyer(
        _png((240, 240, 240)),
        request.model_copy(update={"layout_id": TextLayout.TOP_STACK}),
        context,
    )
    assert classic != top


def test_ink_mass_separates_the_three_tiles() -> None:
    """サムネイルで残るのは明るい / 中間 / 暗いの質量差。"""
    renderer = PillowFlyerRenderer()
    background = (240, 240, 240)
    coverage = {}
    for template_id in TemplateId:
        data = renderer.render_flyer(
            _png(background),
            make_request("ジャズの夜", template_id),
            make_context(template_id),
        )
        coverage[template_id] = _ink_coverage(Image.open(BytesIO(data)), background)
    assert coverage[TemplateId.STYLE_1_BAR_STYLISH] < 0.08
    assert coverage[TemplateId.STYLE_3_VIBRANT_POP] > 0.25
    assert (
        coverage[TemplateId.STYLE_1_BAR_STYLISH]
        < coverage[TemplateId.STYLE_2_WARM_EARTH]
        < coverage[TemplateId.STYLE_3_VIBRANT_POP]
    )


@pytest.mark.parametrize("theme", list(SemanticTheme))
def test_themed_paper_keeps_the_title_readable(theme: SemanticTheme) -> None:
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        render_paper(theme),
        make_request("焚火とシチューを囲む夕べ", semantic_theme=theme),
        make_context(),
    )
    assert Image.open(BytesIO(data)).size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    assert renderer.last_metadata is not None
    assert renderer.last_metadata.contrast_ratio >= 4.5


def test_metadata_records_the_chosen_scale_step() -> None:
    renderer = PillowFlyerRenderer()
    renderer.render_flyer(
        _png((240, 240, 240)),
        make_request("JAZZ"),
        make_context(),
    )
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.title_font_size == design.TITLE_STEPS[0]
    assert metadata.accent_color.startswith("#")
    assert metadata.title_block_height == design.line_height(
        metadata.title_font_size,
        design.HEADING_LINE_RATIO,
    )


def test_a_dark_photo_gets_a_white_title() -> None:
    """暗い写真の上で墨を置くと、題名が黒く沈む。地の色から選び直す。"""
    renderer = PillowFlyerRenderer()
    renderer.render_flyer(
        _png((60, 40, 25)),
        make_request("焚火とシチューを囲む夕べ"),
        make_context(),
    )
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.title_color == "#FFFFFF"
    assert metadata.contrast_ratio >= design.WCAG_AA_CONTRAST


def _sky_with_a_dark_subject() -> bytes:
    """桃クリームの空の帯に、暗い人物（髪と服）が入り込んだ写真。"""
    image = Image.new("RGB", (CANVAS_WIDTH, CANVAS_HEIGHT), (246, 238, 226))
    ImageDraw.Draw(image).rectangle((0, 360, CANVAS_WIDTH, 700), fill=(30, 26, 24))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_a_bright_sky_with_a_dark_subject_keeps_the_title_readable() -> None:
    """空と人物が混ざった帯でも、いちばん不利なセルで 4.5:1 を満たす。

    平均色で測ると、明るい空と暗い服が混ざって「読める」と報告してしまう。
    題の帯を格子に割り、最悪のセルで色とベールを決める。
    """
    renderer = PillowFlyerRenderer()
    request = make_request(
        "ハロウィン おやこマルシェ",
        semantic_theme=SemanticTheme.CANDY,
    )
    data = renderer.render_flyer(_sky_with_a_dark_subject(), request, make_context())
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.contrast_ratio >= design.WCAG_AA_CONTRAST
    # 地を寄せないと読めない帯なので、ベールが立っている。
    assert metadata.backdrop_applied is True

    # 描画した画像の題の帯を、実際に格子で測り直す。
    font_path = renderer.font_path_for(request.template_id)
    stack = stack_for(TextLayout.CLASSIC)
    plan = poster.plan_for_request(
        request,
        title=fit_to_scale(
            request.title,
            font_path,
            _scratch_draw(),
            max_width=design.CONTENT_WIDTH,
            max_height=stack.title_height,
            allow_hanging=design.variant_for(request.template_id).align == "left",
        ),
        stack=stack,
        accent=make_context().suggested_accent_color,
    )
    title = plan.slot("title")
    assert title is not None
    rendered = Image.open(BytesIO(data)).convert("RGB")
    samples = cell_samples(rendered, title.area)
    assert worst_case_contrast(hex_to_rgb(metadata.title_color), samples) >= (
        design.WCAG_AA_CONTRAST
    )


def test_a_bright_photo_keeps_the_ink_title() -> None:
    renderer = PillowFlyerRenderer()
    renderer.render_flyer(
        _png((240, 240, 240)),
        make_request("焚火とシチューを囲む夕べ"),
        make_context(),
    )
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.title_color != "#FFFFFF"
    assert metadata.title_color_adjusted is False


def test_a_chosen_white_title_darkens_the_ground_instead_of_the_type() -> None:
    """白を選んだら、文字ではなく地を暗くする。選んだ色を変えない。"""
    renderer = PillowFlyerRenderer()
    request = make_request("焚火とシチューを囲む夕べ").model_copy(
        update={"title_color": "#FFFFFF"}
    )
    context = make_context()
    data = renderer.render_flyer(_png((240, 240, 240)), request, context)
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.title_color == "#FFFFFF"
    assert metadata.contrast_ratio >= design.WCAG_AA_CONTRAST

    font_path = renderer.font_path_for(request.template_id)
    stack = stack_for(TextLayout.CLASSIC)
    plan = poster.plan_for_request(
        request,
        title=fit_to_scale(
            request.title,
            font_path,
            _scratch_draw(),
            max_height=stack.title_height,
            allow_hanging=False,
        ),
        stack=stack,
        accent=context.suggested_accent_color,
    )
    title = plan.slot("title")
    assert title is not None
    x, y, width, height = title.box
    # 題名の地は紙より暗い（白を保つために地を寄せた）。
    ground = average_rgb(Image.open(BytesIO(data)).convert("RGB"), (x, y, x + width, y + height))
    assert relative_luminance(*ground) < 0.5


def test_a_chosen_colour_that_cannot_be_read_is_moved_to_the_ink_side() -> None:
    """地とほぼ同じ明るさの色を選んだら、ベールでは救えないので色を寄せる。"""
    renderer = PillowFlyerRenderer()
    renderer.render_flyer(
        _png((240, 240, 240)),
        make_request("焚火とシチューを囲む夕べ").model_copy(
            update={"title_color": "#EEEEEE"}
        ),
        make_context(),
    )
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.title_color_adjusted is True
    assert metadata.contrast_ratio >= design.WCAG_AA_CONTRAST


def test_resolve_title_color_follows_the_ground() -> None:
    ink = (31, 41, 55)
    dark = poster.resolve_title_color(None, ink, (60, 40, 25))
    assert dark == (255, 255, 255)
    light = poster.resolve_title_color(None, ink, (240, 240, 240))
    assert light == ink
    # 選ばれた色は動かさない。読みにくければベールの向きで地を寄せる。
    assert poster.resolve_title_color((255, 255, 255), ink, (240, 240, 240)) == (
        255,
        255,
        255,
    )


def test_a_dark_theme_veils_a_bright_photo_darker_not_lighter() -> None:
    """紙が暗いテーマ（ネオン）でも、明るい題のベールは暗く敷く。

    `surface_for(paper, "ink")` は紙が暗いと明るい面を返す。明るい題の上に
    明るいベールを敷くと 4.5:1 に届かず、ベールは敷かれない。題が写真の明るい
    ビームに重なったとき、白い字が白い地に溶ける。
    """
    image = Image.new("RGB", (CANVAS_WIDTH, CANVAS_HEIGHT), (214, 176, 120))
    ImageDraw.Draw(image).rectangle((0, 300, CANVAS_WIDTH, 620), fill=(250, 240, 220))
    buffer = BytesIO()
    image.save(buffer, format="PNG")

    renderer = PillowFlyerRenderer()
    renderer.render_flyer(
        buffer.getvalue(),
        make_request("DJナイト Vol.7", semantic_theme=SemanticTheme.NEON),
        make_context(),
    )
    metadata = renderer.last_metadata
    assert metadata is not None
    # 明るい写真なので、明るい題を選び、暗いベールで地を沈める。
    assert relative_luminance(*hex_to_rgb(metadata.title_color)) > 0.5
    assert metadata.overlay_alpha is not None and metadata.overlay_alpha > 0
    assert metadata.contrast_ratio >= design.WCAG_AA_CONTRAST


def test_ensure_contrast_moves_to_the_side_that_can_reach_the_ratio() -> None:
    """白では届かない地では、白ではなく黒へ寄せる。

    地の相対輝度が 0.18〜0.5 のあいだ（写真の空や木の幹）では、白文字は
    4.5:1 に届かない。それでも「地が暗めだから白」と決め打つと、差し色の日付と
    補助文字の時刻が白一色へ潰れる。墨へ寄せれば短い歩数で届く。
    """
    accent = hex_to_rgb("#8B2635")
    ground = (150, 140, 128)
    ground_luminance = relative_luminance(*ground)
    # 前提: この地では白が届かない。
    assert contrast_ratio(relative_luminance(255, 255, 255), ground_luminance) < (
        design.WCAG_AA_CONTRAST
    )

    fixed = design.ensure_contrast(accent, ground)

    assert fixed != (255, 255, 255)
    # 差し色の色相（赤が最も強い）を残す。
    assert fixed[0] > fixed[1] and fixed[0] > fixed[2]
    assert contrast_ratio(relative_luminance(*fixed), ground_luminance) >= (
        design.WCAG_AA_CONTRAST
    )


def _record_slot_colours(
    monkeypatch: pytest.MonkeyPatch,
    background: bytes,
    request: FlyerGenerationRequest,
) -> tuple[dict[str, tuple[int, int, int]], object]:
    """描画したスロットごとの最終的な文字色と、描画の記録を集める。"""
    recorded: dict[str, tuple[int, int, int]] = {}
    original = poster._draw_slot

    def spy(draw, slot, font, color=None):  # type: ignore[no-untyped-def]
        recorded[slot.role] = color if color is not None else slot.color
        return original(draw, slot, font, color)

    monkeypatch.setattr(poster, "_draw_slot", spy)
    renderer = PillowFlyerRenderer()
    renderer.render_flyer(background, request, make_context())
    return recorded, renderer.last_metadata


def test_the_headline_group_shares_one_colour(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """日付・時刻・題は同じ帯に載る。1 色にそろえ、階層は大きさで示す。

    ここを役割ごとの色（日付は差し色、時刻は補助色、題は墨）に分けると、写真の上で
    同じ帯に載っているのに 3 つが別々の色へ寄る。暗い写真では日付だけ鮮やかな
    水色、時刻は灰色、題は白、のようにばらけて統一感がなくなる。
    """
    ground = Image.new("RGB", (CANVAS_WIDTH, CANVAS_HEIGHT), (214, 205, 188))
    ImageDraw.Draw(ground).rectangle((90, 300, 360, 460), fill=(150, 140, 128))
    buffer = BytesIO()
    ground.save(buffer, format="PNG")

    request = make_request("秋のゆるごはん会", semantic_theme=SemanticTheme.PARCHMENT)
    recorded, metadata = _record_slot_colours(monkeypatch, buffer.getvalue(), request)

    assert recorded["eyebrow"] == recorded["meta"] == recorded["title"]
    # 明るい紙の上なので、墨の側を選ぶ（白固定にしない）。
    assert relative_luminance(*recorded["title"]) < 0.25
    assert metadata is not None
    assert metadata.contrast_ratio >= design.WCAG_AA_CONTRAST


def test_a_dark_photo_keeps_the_headline_group_light(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """暗い写真では、日付・時刻・題の 3 つとも明るい側へそろえる。

    帯の一部にだけ明るいビームが入っていても、3 つは 1 色なので同じ濃さへ寄る。
    ここが役割ごとに別判定だと、日付だけ白、時刻だけ灰色、題だけ別の白になる。
    """
    ground = Image.new("RGB", (CANVAS_WIDTH, CANVAS_HEIGHT), (24, 20, 34))
    # 題の帯の左下にだけ、明るいビームを置く。日付と時刻の行には掛けない。
    ImageDraw.Draw(ground).rectangle((120, 270, 420, 340), fill=(236, 226, 208))
    buffer = BytesIO()
    ground.save(buffer, format="PNG")

    request = make_request("DJナイト Vol.7", semantic_theme=SemanticTheme.NEON)
    recorded, metadata = _record_slot_colours(monkeypatch, buffer.getvalue(), request)

    assert recorded["eyebrow"] == recorded["meta"] == recorded["title"]
    # 暗い写真なので、明るい側（テーマの墨が明るいネオンではその色）を選ぶ。
    assert relative_luminance(*recorded["title"]) > 0.5
