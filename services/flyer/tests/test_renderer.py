"""決定論的レンダラーの幾何・コントラスト検証。"""

from __future__ import annotations

import inspect
import random
from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from src.adapters.candidate_source.sample_ground import render_sample_ground
from src.adapters.renderer import layout_calculator
from src.adapters.renderer.layout_calculator import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    HIGH_FREQUENCY_EDGE_VARIANCE,
    TITLE_MAX_HEIGHT,
    TITLE_MAX_WIDTH,
    TITLE_MIN_FONT_SIZE,
    average_rgb,
    blend_rgb,
    calculate_optimal_font_and_lines,
    choose_backdrop,
    contrast_ratio,
    edge_variance,
    measure_text_block,
    relative_luminance,
    requires_contrast_protection,
)
from src.adapters.renderer.layouts import zones_for
from src.adapters.renderer.pillow_renderer import PillowFlyerRenderer
from src.domain.exceptions import RenderingError
from src.domain.models import SemanticTheme, TemplateId, TextLayout
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


def test_edge_variance_separates_flat_color_from_noise() -> None:
    flat = Image.new("RGB", (80, 80), (20, 20, 20))
    rng = random.Random(0)
    noisy = Image.new("RGB", (80, 80))
    noisy.putdata([(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(80 * 80)])
    assert edge_variance(flat) < HIGH_FREQUENCY_EDGE_VARIANCE
    assert edge_variance(noisy) >= HIGH_FREQUENCY_EDGE_VARIANCE


def test_calculator_keeps_extreme_titles_inside_the_title_box() -> None:
    renderer = PillowFlyerRenderer()
    font_path = renderer.font_path_for(TemplateId.STYLE_1_BAR_STYLISH)
    scratch = Image.new("RGB", (8, 8))
    draw = ImageDraw.Draw(scratch)
    for title in ("JAZZ", "あ" * 40):
        spacing = 15 if len(title) < 10 else 0
        font, lines = calculate_optimal_font_and_lines(
            title,
            font_path,
            draw,
            letter_spacing=spacing,
        )
        width, height = measure_text_block(draw, lines, font, letter_spacing=spacing)
        assert len(lines) <= 3
        assert width <= TITLE_MAX_WIDTH
        assert height <= TITLE_MAX_HEIGHT
        assert font.size >= TITLE_MIN_FONT_SIZE


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
    assert metadata.title_block_width <= TITLE_MAX_WIDTH
    assert metadata.title_block_height <= TITLE_MAX_HEIGHT
    assert metadata.title_line_count <= 3


@pytest.mark.parametrize("title", ["JAZZ", "あ" * 40])
def test_extreme_titles_render_inside_zone_b(title: str) -> None:
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        _png((250, 220, 40)),
        make_request(title, TemplateId.STYLE_1_BAR_STYLISH),
        make_context(TemplateId.STYLE_1_BAR_STYLISH),
    )
    assert Image.open(BytesIO(data)).size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.title_line_count <= 3
    assert metadata.title_block_width <= TITLE_MAX_WIDTH
    assert metadata.title_block_height <= TITLE_MAX_HEIGHT
    assert metadata.title_font_size >= TITLE_MIN_FONT_SIZE
    assert metadata.contrast_ratio >= 4.5
    if len(title) < 10:
        assert metadata.letter_spacing_px == 15
    else:
        assert metadata.letter_spacing_px == 0


def test_high_frequency_background_still_renders() -> None:
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        _noise_png(),
        make_request("JAZZ", TemplateId.STYLE_3_VIBRANT_POP),
        make_context(TemplateId.STYLE_3_VIBRANT_POP),
    )
    assert Image.open(BytesIO(data)).size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    metadata = renderer.last_metadata
    assert metadata is not None
    assert metadata.outline_applied is True
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
    for module in (
        layout_calculator,
        __import__("src.adapters.renderer.pillow_renderer", fromlist=["pillow_renderer"]),
        __import__("src.adapters.renderer.layouts", fromlist=["layouts"]),
    ):
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
    zones = zones_for(layout_id)
    assert metadata.title_block_width <= zones.b.width
    assert metadata.title_block_height <= zones.b.height
    assert metadata.contrast_ratio >= 4.5


def test_top_stack_leaves_the_lower_band_empty() -> None:
    """「上にまとめる」は下半分を空ける。背景がそのまま残ることを画素で確かめる。"""
    renderer = PillowFlyerRenderer()
    template_id = TemplateId.STYLE_3_VIBRANT_POP
    data = renderer.render_flyer(
        _png((240, 240, 240)),
        make_request(template_id=template_id, layout_id=TextLayout.TOP_STACK),
        make_context(template_id),
    )
    image = Image.open(BytesIO(data)).convert("RGB")
    zones = zones_for(TextLayout.TOP_STACK)
    band_top = zones.e.y + zones.e.height + 40
    mean = average_rgb(image, (80, band_top, CANVAS_WIDTH - 80, CANVAS_HEIGHT - 40))
    assert all(abs(channel - 240) <= 8 for channel in mean), mean


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


def test_scrim_follows_the_theme_brightness() -> None:
    """地の明度でスクリムの向きを変える。羊皮紙で黒い紙面にしない。"""
    renderer = PillowFlyerRenderer()
    zone = zones_for(TextLayout.CLASSIC).a

    def upper_band(theme: SemanticTheme) -> tuple[int, int, int]:
        data = renderer.render_flyer(
            render_sample_ground(theme),
            make_request(
                template_id=TemplateId.STYLE_1_BAR_STYLISH,
                semantic_theme=theme,
            ),
            make_context(TemplateId.STYLE_1_BAR_STYLISH),
        )
        image = Image.open(BytesIO(data)).convert("RGB")
        return average_rgb(image, zone.box)

    parchment = upper_band(SemanticTheme.PARCHMENT)
    neon = upper_band(SemanticTheme.NEON)
    assert sum(parchment) > sum(neon) + 150
    assert renderer.last_metadata is not None
    assert renderer.last_metadata.contrast_ratio >= 4.5


def test_category_label_is_not_burned_in() -> None:
    """利用者が入力していない種目名を紙面へ焼かない。zone A は空けておく。"""
    renderer = PillowFlyerRenderer()
    data = renderer.render_flyer(
        _png((240, 240, 240)),
        make_request(),
        make_context(),
    )
    image = Image.open(BytesIO(data)).convert("L")
    zone = zones_for(TextLayout.CLASSIC).a
    values = image.crop(zone.box).tobytes()
    assert max(values) - min(values) <= 8
