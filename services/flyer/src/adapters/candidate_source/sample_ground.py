"""選択肢の見本に使う、写真らしいサンプル紙面の地。

ステップ 1 の 3 枚は「同じ地・同じ差し色・同じ配置」で並べ、書体と寄せだけを
比べさせる。そのため地は 1 枚を 3 枚で共有する。平らな 2 色グラデーションは
安っぽく見えるので、光源・ぼけ玉・周辺の減光・粒子で奥行きを作る。

画像モデルは呼ばない。`random.Random` の種をテーマと variant から決めるので、
同じ入力なら何度描いても同じバイト列になる。
"""

from __future__ import annotations

import random
from functools import lru_cache
from io import BytesIO
from math import hypot

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from src.domain.models import SemanticTheme
from src.domain.semantic_theme import (
    RGB,
    WHITE,
    blend,
    parse_hex,
    shade,
    theme_key,
    theme_look,
)

#: チラシと同じ A4 縦。レンダラーが cover で切り抜くので比率を揃えておく。
_SAMPLE_SIZE: tuple[int, int] = (1080, 1528)

#: 地の勾配を組む粗いグリッドの分割数。拡大して使うので細かくする必要がない。
_COARSE_DIVISOR = 10


def _coarse(size: tuple[int, int]) -> tuple[int, int]:
    width, height = size
    return max(2, width // _COARSE_DIVISOR), max(2, height // _COARSE_DIVISOR)


def _seed(key: str) -> int:
    """プロセスを跨いでも同じ値になる種。`hash()` は使わない。"""
    return sum((index + 1) * ord(char) for index, char in enumerate(key))


def _composite(canvas: Image.Image, layer: Image.Image) -> Image.Image:
    return Image.alpha_composite(canvas.convert("RGBA"), layer).convert("RGB")


def _diagonal_base(
    size: tuple[int, int],
    top: RGB,
    bottom: RGB,
    drift: float,
) -> Image.Image:
    """左上が明るく右下が暗い、ゆるい斜めの地。"""
    width, height = size
    coarse_w, coarse_h = _coarse(size)
    small = Image.new("RGB", (coarse_w, coarse_h))
    draw = ImageDraw.Draw(small)
    for y in range(coarse_h):
        vertical = y / max(1, coarse_h - 1)
        for x in range(coarse_w):
            horizontal = x / max(1, coarse_w - 1)
            progress = min(1.0, max(0.0, 0.6 * vertical + drift * horizontal))
            draw.point((x, y), fill=blend(top, bottom, progress))
    return small.resize(size, Image.Resampling.BICUBIC)


def _glow(
    size: tuple[int, int],
    center: tuple[float, float],
    radius: float,
    color: RGB,
    peak: float,
) -> Image.Image:
    """ぼかした円。光源にもぼけ玉にも使う。

    `center` は 0〜1 の割合。`radius` は出力画素。ぼかしは半径の 3 割にして、
    輪郭が残らないようにする。
    """
    width, height = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    cx = center[0] * (width - 1)
    cy = center[1] * (height - 1)
    alpha = max(0, min(255, int(round(peak * 255))))
    ImageDraw.Draw(layer).ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill=(*color, alpha),
    )
    return layer.filter(ImageFilter.GaussianBlur(max(1.0, radius * 0.3)))


def _horizon(
    canvas: Image.Image,
    ratio: float,
    color: RGB,
    strength: float,
) -> Image.Image:
    """手前の面（机・床・ステージ）を 1 枚入れる。

    グラデーションだけだと「素材」に見えるが、ぼけた水平の境界が 1 本あると
    「ぼけた写真」に見える。境界は大きくぼかして、線として残さない。
    """
    width, height = canvas.size
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    top = int(height * ratio)
    ImageDraw.Draw(layer).rectangle(
        (0, top, width, height),
        fill=(*color, max(0, min(255, int(round(strength * 255))))),
    )
    return _composite(canvas, layer.filter(ImageFilter.GaussianBlur(90.0)))


def _vignette_mask(size: tuple[int, int], strength: float) -> Image.Image:
    """中心を残して端を落とす乗算マスク。"""
    width, height = size
    coarse_w, coarse_h = _coarse(size)
    small = Image.new("L", (coarse_w, coarse_h))
    draw = ImageDraw.Draw(small)
    for y in range(coarse_h):
        ny = (y / max(1, coarse_h - 1)) * 2.0 - 1.0
        for x in range(coarse_w):
            nx = (x / max(1, coarse_w - 1)) * 2.0 - 1.0
            distance = min(1.0, hypot(nx, ny) / 1.4142)
            draw.point((x, y), fill=int(round(255 * (1.0 - strength * distance**2))))
    mask = small.resize(size, Image.Resampling.BILINEAR)
    return Image.merge("RGB", (mask, mask, mask))


def _grain(
    canvas: Image.Image,
    rng: random.Random,
    *,
    strength: float = 0.06,
) -> Image.Image:
    """粒子を薄く重ねる。写真のざらつきを出し、のっぺり感を消す。

    `Image.effect_noise` は呼ぶたびに種が変わるため使わない。`random.Random` から
    作れば、同じ入力で同じバイト列になる。
    """
    width, height = canvas.size
    noise = Image.frombytes("L", canvas.size, rng.randbytes(width * height))
    noise = noise.point(lambda value: int(128 + (value - 128) * 0.12))
    return Image.blend(canvas, Image.merge("RGB", (noise, noise, noise)), strength)


def _bokeh(
    canvas: Image.Image,
    rng: random.Random,
    glow: RGB,
    accent: RGB,
    *,
    dark: bool,
    count: int,
) -> Image.Image:
    """ぼけ玉。明るい地では白が消えるので、差し色を混ぜて色で奥行きを出す。"""
    for _ in range(count):
        center = (rng.uniform(0.05, 0.95), rng.uniform(0.06, 0.94))
        radius = rng.uniform(34.0, 96.0)
        if dark:
            tint = blend(glow, WHITE, rng.uniform(0.1, 0.6))
            peak = rng.uniform(0.08, 0.18)
        else:
            tint = blend(accent, glow, rng.uniform(0.0, 0.7))
            peak = rng.uniform(0.06, 0.14)
        canvas = _composite(canvas, _glow(canvas.size, center, radius, tint, peak))
    return canvas


def _paint_ground(theme: SemanticTheme | None, variant: int) -> bytes:
    """1 枚描く。キャッシュを通さない実体。"""
    look = theme_look(theme)
    rng = random.Random(_seed(f"{theme_key(theme)}-{variant}"))
    base = parse_hex(look.base)
    glow = parse_hex(look.glow)
    accent = parse_hex(look.accent)
    dark = look.ground == "dark"

    # 暗い地は幅を大きく取り、明るい地は白飛びしない範囲で陰影を付ける。
    top = shade(base, 1.55 if dark else 1.05)
    bottom = shade(base, 0.55 if dark else 0.90)
    canvas = _diagonal_base(_SAMPLE_SIZE, top, bottom, drift=0.45)

    # 手前の面。境界は文字の無い帯に置き、文字の読みやすさを邪魔しない。
    canvas = _horizon(
        canvas,
        0.60 if dark else 0.58,
        shade(base, 1.35 if dark else 0.95),
        0.55 if dark else 0.38,
    )

    # 光源は上寄り、左右は少しずらす。中央を空けて文字を載せやすくする。
    light_center = (0.62 + rng.uniform(-0.1, 0.1), 0.11)
    canvas = _composite(
        canvas,
        _glow(_SAMPLE_SIZE, light_center, 720.0, glow, 0.30 if dark else 0.28),
    )
    # 差し色の返りを反対側の下に入れると、2 色に見えて安っぽさが消える。
    canvas = _composite(
        canvas,
        _glow(_SAMPLE_SIZE, (0.15, 0.72), 520.0, accent, 0.16 if dark else 0.12),
    )
    canvas = _bokeh(canvas, rng, glow, accent, dark=dark, count=7)

    canvas = ImageChops.multiply(
        canvas,
        _vignette_mask(_SAMPLE_SIZE, 0.22 if dark else 0.10),
    )
    return _encode_png(_grain(canvas, rng))


def _encode_png(canvas: Image.Image) -> bytes:
    buffer = BytesIO()
    canvas.save(buffer, format="PNG")
    return buffer.getvalue()


@lru_cache(maxsize=64)
def render_sample_ground(theme: SemanticTheme | None = None, variant: int = 0) -> bytes:
    """サンプル紙面の地を PNG で返す。同じ引数は同じバイト列。"""
    return _paint_ground(theme, variant)


__all__ = ["render_sample_ground"]
