"""API キーが無くても動く、ローカル合成の候補背景。

テーマの紙色を濃さだけ変えた紙を返す。画像モデルを呼ばないので、候補枚数を
増やしても課金も待ち時間も増えない。作り直すと濃さだけが変わり、色相は動かない。
"""

from __future__ import annotations

from src.adapters.candidate_source.paper_ground import PAPER_TONE_COUNT, render_paper
from src.domain.models import FlyerGenerationRequest, LLMGenerationContext
from src.ports.candidate_source_port import BackgroundOption, CandidateSourcePort

#: 背景の作り直しで出す紙の名前。地の濃さだけを変え、色相は変えない。
_VARIANT_LABELS: tuple[tuple[str, str], ...] = (
    ("定番", "テーマの紙色をそのまま"),
    ("明るめ", "紙をわずかに明るく"),
    ("落ち着き", "紙をわずかに沈めて"),
    ("深め", "紙を濃く落として"),
)


class PlaceholderCandidateSource(CandidateSourcePort):
    """テーマ色の紙だけで候補を埋める。原価ゼロ。"""

    @property
    def source_id(self) -> str:
        return "placeholder"

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
                    background=render_paper(request.semantic_theme, index % PAPER_TONE_COUNT),
                    label=label,
                    description=description,
                    source="placeholder",
                )
            )
        return options


__all__ = ["PlaceholderCandidateSource"]
