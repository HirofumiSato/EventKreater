"""紙の地の決定性と、紙らしさの検証。

ぼけ玉や偽の水平線を捨てたので、地は「平らに近い紙」になる。ここでは
同じ入力で同じバイト列になること、濃さの順が保たれること、そして写真の
ような高周波を持たないことを確かめる。
"""

from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from src.adapters.candidate_source.paper_ground import PAPER_TONE_COUNT, render_paper
from src.adapters.renderer.layout_calculator import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    HIGH_FREQUENCY_EDGE_VARIANCE,
    edge_variance,
)
from src.domain.models import SemanticTheme


def _image(payload: bytes) -> Image.Image:
    return Image.open(BytesIO(payload)).convert("RGB")


def _mean_luminance(image: Image.Image) -> float:
    thumbnail = image.resize((32, 45))
    pixels = list(thumbnail.getdata())
    return sum(sum(pixel) for pixel in pixels) / (len(pixels) * 3)


def test_paper_matches_the_canvas() -> None:
    image = _image(render_paper(SemanticTheme.PARCHMENT))
    assert image.size == (CANVAS_WIDTH, CANVAS_HEIGHT)
    assert render_paper(SemanticTheme.PARCHMENT)[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize("theme", list(SemanticTheme))
def test_same_theme_paints_the_same_bytes(theme: SemanticTheme) -> None:
    assert render_paper(theme) == render_paper(theme)


def test_step_one_shares_one_paper_across_the_three_tiles() -> None:
    """3 枚は同じ紙。色の差ではなく書体と寄せの差を見せるため。"""
    papers = {render_paper(SemanticTheme.NEON, 0) for _ in range(3)}
    assert len(papers) == 1


def test_tones_go_dark_as_the_index_grows() -> None:
    values = [
        _mean_luminance(_image(render_paper(SemanticTheme.PARCHMENT, tone)))
        for tone in range(PAPER_TONE_COUNT)
    ]
    # 1.0 / 1.05 / 0.93 / 0.86 の順に作るので、いちばん明るいのは 2 枚目。
    assert values[1] > values[0] > values[2] > values[3]


@pytest.mark.parametrize("theme", list(SemanticTheme))
def test_paper_has_no_photo_texture(theme: SemanticTheme) -> None:
    """ぼけ玉も水平線も無い。高周波は紙の繊維の範囲に収まる。"""
    image = _image(render_paper(theme))
    assert edge_variance(image) < HIGH_FREQUENCY_EDGE_VARIANCE
    # 紙は 1 色に近い。平均からの偏りが大きいと「写真」に見える。
    mean = _mean_luminance(image)
    thumbnail = image.resize((24, 34))
    for pixel in thumbnail.getdata():
        assert abs(sum(pixel) / 3 - mean) < 12


def test_themes_keep_their_own_papers() -> None:
    dark = _mean_luminance(_image(render_paper(SemanticTheme.NEON)))
    light = _mean_luminance(_image(render_paper(SemanticTheme.PARCHMENT)))
    assert light > dark + 100
