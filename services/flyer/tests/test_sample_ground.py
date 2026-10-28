"""選択肢の見本に使うサンプル紙面の地。"""

from __future__ import annotations

import statistics
from io import BytesIO

import pytest
from PIL import Image

from src.adapters.candidate_source.sample_ground import (
    _paint_ground,
    render_sample_ground,
)
from src.domain.models import SemanticTheme

_SAMPLE_SIZE = (1080, 1528)


def _thumb(payload: bytes) -> Image.Image:
    return Image.open(BytesIO(payload)).convert("RGB").resize((64, 90))


def _luminances(image: Image.Image) -> list[float]:
    """8 ビットの輝度へ落として、画素ごとの明るさを返す。"""
    return [float(value) for value in image.convert("L").tobytes()]


def _mean_luminance(image: Image.Image) -> float:
    return statistics.fmean(_luminances(image))


def test_same_input_renders_identical_bytes() -> None:
    first = _paint_ground(SemanticTheme.PARCHMENT, 0)
    second = _paint_ground(SemanticTheme.PARCHMENT, 0)
    assert first == second


def test_variant_changes_the_picture() -> None:
    assert _paint_ground(SemanticTheme.NEON, 0) != _paint_ground(SemanticTheme.NEON, 1)


def test_themes_do_not_share_the_same_ground() -> None:
    grounds = {theme: render_sample_ground(theme) for theme in SemanticTheme}
    assert len(set(grounds.values())) == len(SemanticTheme)


@pytest.mark.parametrize("theme", list(SemanticTheme) + [None])
def test_ground_is_a4_portrait_png(theme: SemanticTheme | None) -> None:
    payload = render_sample_ground(theme)
    assert payload.startswith(b"\x89PNG")
    assert Image.open(BytesIO(payload)).size == _SAMPLE_SIZE


@pytest.mark.parametrize(
    "light",
    [
        SemanticTheme.ENTERPRISE_CLEAN,
        SemanticTheme.PARCHMENT,
        SemanticTheme.NEO_BRUTALISM,
        None,
    ],
)
@pytest.mark.parametrize("dark", [SemanticTheme.MODERN_SLATE, SemanticTheme.NEON])
def test_light_ground_is_much_brighter_than_dark_ground(
    light: SemanticTheme | None,
    dark: SemanticTheme,
) -> None:
    """テーマの明度が地に反映される。羊皮紙で黒い紙面になる事故を防ぐ。"""
    light_mean = _mean_luminance(_thumb(render_sample_ground(light)))
    dark_mean = _mean_luminance(_thumb(render_sample_ground(dark)))
    assert light_mean > dark_mean + 40


@pytest.mark.parametrize("theme", list(SemanticTheme) + [None])
def test_ground_has_depth_instead_of_a_flat_gradient(theme: SemanticTheme | None) -> None:
    """平らな 2 色グラデーションだと選択肢が安っぽく見える。陰影の幅を固定する。"""
    values = _luminances(_thumb(render_sample_ground(theme)))
    assert statistics.pstdev(values) >= 6.0


def test_ground_is_lit_from_above() -> None:
    """光源は上寄り。上を明るく、下を落として、写真らしい奥行きを作る。"""
    image = _thumb(render_sample_ground(SemanticTheme.MODERN_SLATE))
    upper = statistics.fmean(_luminances(image.crop((0, 0, 64, 24))))
    lower = statistics.fmean(_luminances(image.crop((0, 66, 64, 90))))
    assert upper > lower
