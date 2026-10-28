"""API キーが無くても動く、ローカル合成の候補背景。

テンプレートごとの 2 色を HSV でずらして 8 通りを作る。画像モデルを呼ばない
ので、候補枚数を増やしても課金も待ち時間も増えない。
"""

from __future__ import annotations

import colorsys

from src.adapters.candidate_source.palettes import default_palette
from src.adapters.image_generator.gradients import render_gradient_png
from src.domain.models import FlyerGenerationRequest, LLMGenerationContext, TemplateId
from src.ports.candidate_source_port import BackgroundOption, CandidateSourcePort

_RGB = tuple[int, int, int]

_TEMPLATE_STOPS: dict[TemplateId, tuple[_RGB, _RGB]] = {
    TemplateId.STYLE_1_BAR_STYLISH: ((12, 16, 32), (42, 24, 18)),
    TemplateId.STYLE_2_WARM_EARTH: ((244, 228, 208), (186, 132, 90)),
    TemplateId.STYLE_3_VIBRANT_POP: ((190, 24, 93), (250, 204, 21)),
}

#: (色相の回転角, 明度の倍率, ラベル, 説明)
_VARIANTS: tuple[tuple[float, float, str, str], ...] = (
    (0.0, 1.00, "定番", "テンプレートの標準的な色合い"),
    (14.0, 1.06, "明るめ", "少し明るく軽い印象"),
    (-14.0, 0.92, "落ち着き", "彩度を抑えた大人の雰囲気"),
    (28.0, 1.10, "鮮やか", "彩度を上げた華やかな背景"),
    (-28.0, 0.85, "シック", "暗めで落ち着いた背景"),
    (42.0, 1.00, "彩り", "色味を大きく振った背景"),
    (-42.0, 1.15, "淡め", "淡く柔らかい背景"),
    (7.0, 0.78, "深め", "深みのある暗い背景"),
)

_SIZE: tuple[int, int] = (1080, 1528)


def _shift(rgb: _RGB, hue_degrees: float, value_scale: float) -> _RGB:
    red, green, blue = (channel / 255.0 for channel in rgb)
    hue, saturation, value = colorsys.rgb_to_hsv(red, green, blue)
    hue = (hue + hue_degrees / 360.0) % 1.0
    value = max(0.0, min(1.0, value * value_scale))
    shifted = colorsys.hsv_to_rgb(hue, saturation, value)
    return tuple(int(round(channel * 255)) for channel in shifted)  # type: ignore[return-value]


def _variant_stops(
    template_id: TemplateId,
    index: int,
) -> tuple[_RGB, _RGB, tuple[float, float, str, str]]:
    top, bottom = _TEMPLATE_STOPS[template_id]
    hue, value, label, description = _VARIANTS[index % len(_VARIANTS)]
    return (
        _shift(top, hue, value),
        _shift(bottom, hue, value),
        (hue, value, label, description),
    )


class PlaceholderCandidateSource(CandidateSourcePort):
    """グラデーションだけで候補を埋める。原価ゼロ。"""

    @property
    def source_id(self) -> str:
        return "placeholder"

    async def preview_background(self, template_id: TemplateId) -> bytes:
        top, bottom, _ = _variant_stops(template_id, 0)
        return render_gradient_png(_SIZE, top, bottom)

    async def suggest_backgrounds(
        self,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
        count: int,
    ) -> list[BackgroundOption]:
        # context は将来 AI／ネット取得へ差し替えたときに使う。いまは読まない。
        del context
        options: list[BackgroundOption] = []
        for index in range(max(1, count)):
            top, bottom, (_, _, label, description) = _variant_stops(
                request.template_id,
                index,
            )
            options.append(
                BackgroundOption(
                    background=render_gradient_png(_SIZE, top, bottom),
                    label=label,
                    description=description,
                    source="placeholder",
                )
            )
        return options


def default_accent_for(template_id: TemplateId) -> str:
    """ステップ 1 のサンプルで使うアクセント色。"""
    return default_palette(template_id).accent_color


__all__ = ["PlaceholderCandidateSource", "default_accent_for"]
