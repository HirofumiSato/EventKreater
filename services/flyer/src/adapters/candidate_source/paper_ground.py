"""見本に使う紙の地。

AI を使わないときの代替背景として、テーマの紙色に濃さだけを変えた 1 枚を描く。
3 種の紙面はこの 1 枚を親として共有するので、並べたときに色ではなく書体と
寄せの差だけが見える。

かつては光源・ぼけ玉・偽の水平線で「写真らしさ」を作っていたが、198px の
サムネイルでは茶色いもやにしかならず、写真にも紙にも見えなかった。ここでは
テーマの紙色に、繊維のノイズと上下 2% のごく弱い勾配だけを重ねる。紙面の
余白が主役になり、文字の階層が読み取れる。

画像モデルは呼ばない。`random.Random` の種をテーマと濃さから決めるので、同じ
入力なら何度描いても同じバイト列になる。
"""

from __future__ import annotations

import random
from functools import lru_cache
from io import BytesIO

from PIL import Image, ImageDraw, ImageFilter

from src.domain.models import SemanticTheme
from src.domain.semantic_theme import (
    RGB,
    blend,
    parse_hex,
    shade,
    theme_key,
    theme_look,
)

#: チラシと同じ A4 縦。レンダラーが cover で切り抜くので比率を揃えておく。
_PAPER_SIZE: tuple[int, int] = (1080, 1528)

#: 紙の濃さ。作り直しのたびにこの 4 種を順に使う。
#: 1.0 がテーマの紙、そこから明るい側と暗い側へ振る。
_TONES: tuple[float, ...] = (1.0, 1.05, 0.93, 0.86)

#: 上下の明度差。紙の繊維が光を拾う程度に留める。
_GRADIENT_RANGE = 0.02
#: 繊維のノイズの強さ。
_FIBER_STRENGTH = 0.02


def _seed(key: str) -> int:
    """プロセスを跨いでも同じ値になる種。`hash()` は使わない。"""
    return sum((index + 1) * ord(char) for index, char in enumerate(key))


def _gradient(size: tuple[int, int], paper: RGB) -> Image.Image:
    """上端がわずかに明るく、下端がわずかに沈む 1 列の勾配。"""
    width, height = size
    top = blend(paper, (255, 255, 255), _GRADIENT_RANGE)
    bottom = blend(paper, (0, 0, 0), _GRADIENT_RANGE)
    column = Image.new("RGB", (1, height))
    draw = ImageDraw.Draw(column)
    for y in range(height):
        progress = y / max(1, height - 1)
        draw.point((0, y), fill=blend(top, bottom, progress))
    return column.resize(size, Image.Resampling.BILINEAR)


def _fibers(canvas: Image.Image, rng: random.Random) -> Image.Image:
    """紙の繊維。細かいノイズを薄く重ねる。

    `Image.effect_noise` は呼ぶたびに種が変わるため使わない。`random.Random` から
    作れば、同じ入力で同じバイト列になる。
    """
    width, height = canvas.size
    noise = Image.frombytes("L", canvas.size, rng.randbytes(width * height))
    noise = noise.filter(ImageFilter.GaussianBlur(0.8))
    noise = noise.point(lambda value: int(128 + (value - 128) * 0.35))
    grain = Image.merge("RGB", (noise, noise, noise))
    return Image.blend(canvas, grain, _FIBER_STRENGTH)


def _paper_color(theme: SemanticTheme | None, tone: int) -> RGB:
    base = parse_hex(theme_look(theme).base)
    factor = _TONES[tone % len(_TONES)]
    return shade(base, factor)


def _paint_paper(theme: SemanticTheme | None, tone: int) -> bytes:
    """1 枚描く。キャッシュを通さない実体。"""
    rng = random.Random(_seed(f"paper-{theme_key(theme)}-{tone}"))
    canvas = _gradient(_PAPER_SIZE, _paper_color(theme, tone))
    canvas = _fibers(canvas, rng)
    buffer = BytesIO()
    canvas.save(buffer, format="PNG")
    return buffer.getvalue()


@lru_cache(maxsize=64)
def render_paper(theme: SemanticTheme | None = None, tone: int = 0) -> bytes:
    """紙の地を PNG で返す。同じ引数は同じバイト列。"""
    return _paint_paper(theme, tone)


#: ステップ 2 のオフライン候補に出す紙の枚数。
PAPER_TONE_COUNT = len(_TONES)

__all__ = ["PAPER_TONE_COUNT", "render_paper"]
