"""候補背景の供給元。

ローカル合成（テーマ色のサンプル紙面）と、OpenAI の画像生成の 2 実装を持つ。将来
「同梱画像パック」「ネット取得」へ差し替えるための口をここに固定する。差し替えて
も `ProposeCandidatesUseCase` とレンダラーは変更しない。

利用者が持ち込んだ写真は供給元ではなく入力なので、`ImageUploadPort` が
正規化し、`ProposeCandidatesUseCase.create_uploaded_background` が候補にする。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from src.domain.models import FlyerGenerationRequest, LLMGenerationContext


@dataclass(frozen=True)
class BackgroundOption:
    """候補 1 枚分の背景とラベル。"""

    background: bytes
    label: str
    description: str = ""
    #: 供給元。`ai` のときだけ課金が起きる。`CandidateMeta.source` に残る。
    source: str = "placeholder"


class CandidateSourcePort(ABC):
    """候補背景を提案する。ネットワーク I/O を持つのはこの実装だけ。"""

    @property
    @abstractmethod
    def source_id(self) -> str:
        """保存メタに残す供給元の識別子。"""

    @abstractmethod
    async def suggest_backgrounds(
        self,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
        count: int,
    ) -> list[BackgroundOption]:
        """ステップ 1 の候補背景を指定枚数返す。

        `count` が 0 以下でも 1 枚以上を返す（画面が空にならないように）。
        AI の残りが 0 のときは、課金の無い代替を 1 枚返す。
        """
