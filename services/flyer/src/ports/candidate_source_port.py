"""候補背景の供給元。

いまはローカル合成のプレースホルダだけだが、将来「同梱画像パック」「ネット
取得」「AI 生成」へ差し替えるための口をここに固定する。差し替えても
`ProposeCandidatesUseCase` とレンダラーは変更しない。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from src.domain.models import FlyerGenerationRequest, LLMGenerationContext, TemplateId


@dataclass(frozen=True)
class BackgroundOption:
    """候補 1 枚分の背景とラベル。"""

    background: bytes
    label: str
    description: str = ""


class CandidateSourcePort(ABC):
    """候補背景を提案する。ネットワーク I/O を持つのはこの実装だけ。"""

    @property
    @abstractmethod
    def source_id(self) -> str:
        """保存メタに残す供給元の識別子。"""

    @abstractmethod
    async def preview_background(self, template_id: TemplateId) -> bytes:
        """ステップ 1 のサンプルに使う代表背景。"""

    @abstractmethod
    async def suggest_backgrounds(
        self,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
        count: int,
    ) -> list[BackgroundOption]:
        """ステップ 2 の候補背景を指定枚数返す。"""
