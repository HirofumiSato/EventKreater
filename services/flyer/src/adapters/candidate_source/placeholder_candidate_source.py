"""API キーが無くても動く、ローカル合成の候補背景。

テーマの色で「写真らしい」サンプル紙面を描く。画像モデルを呼ばないので、
候補枚数を増やしても課金も待ち時間も増えない。テーマごとに同じ絵柄を使うため、
3 枚並べたときに色ではなく書体の差だけが見える。
"""

from __future__ import annotations

from src.adapters.candidate_source.sample_ground import render_sample_ground
from src.domain.models import (
    FlyerGenerationRequest,
    LLMGenerationContext,
    SemanticTheme,
)
from src.ports.candidate_source_port import BackgroundOption, CandidateSourcePort

#: ステップ 2 の作り直しで出す見本の名前。配置だけを変え、色は変えない。
_VARIANT_LABELS: tuple[tuple[str, str], ...] = (
    ("定番", "テーマの色をそのまま使った背景"),
    ("明るめ", "光を強くした軽い印象"),
    ("落ち着き", "光を弱めた大人の雰囲気"),
    ("立体的", "ぼけ玉を増やした奥行きのある背景"),
    ("シック", "端を暗く落とした落ち着いた背景"),
    ("彩り", "差し色の返りを効かせた背景"),
    ("淡め", "淡く柔らかい背景"),
    ("深め", "深みのある暗い背景"),
)


class PlaceholderCandidateSource(CandidateSourcePort):
    """テーマ色のサンプル紙面だけで候補を埋める。原価ゼロ。"""

    @property
    def source_id(self) -> str:
        return "placeholder"

    async def preview_background(
        self,
        theme: SemanticTheme | None,
        *,
        variant: int = 0,
    ) -> bytes:
        """ステップ 1 の見本。3 枚で同じ地を共有する。"""
        return render_sample_ground(theme, variant)

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
            label, description = _VARIANT_LABELS[index % len(_VARIANT_LABELS)]
            options.append(
                BackgroundOption(
                    background=render_sample_ground(request.semantic_theme, index),
                    label=label,
                    description=description,
                    source="placeholder",
                )
            )
        return options


__all__ = ["PlaceholderCandidateSource"]
