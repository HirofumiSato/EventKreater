"""候補の保存先。

ウィザードの候補は、完成画像・合成前の背景・メタ情報の 3 つを 1 組として保存する。
ユースケースは保存先の実装（ローカルディスク、S3、DB）を知らず、このポートだけを
受け取る。`LocalCandidateStore` はその 1 つの実装。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from src.domain.models import CandidateMeta


class CandidateStorePort(ABC):
    """候補 1 件を、画像・背景・メタの 3 点セットで読み書きする。"""

    @abstractmethod
    def save(
        self,
        candidate_id: str,
        image_bytes: bytes,
        background_bytes: bytes,
        meta: CandidateMeta,
    ) -> str:
        """候補を保存し、表示用の URL を返す。"""

    @abstractmethod
    def load(self, candidate_id: str) -> bytes:
        """完成画像を返す。無ければ `CandidateNotFoundError`。"""

    @abstractmethod
    def load_meta(self, candidate_id: str) -> CandidateMeta:
        """メタ情報を返す。無い、または壊れていれば `CandidateNotFoundError`。"""

    @abstractmethod
    def load_background(self, candidate_id: str) -> bytes:
        """合成前の背景を返す。配置・配色のやり直しに使う。"""


__all__ = ["CandidateStorePort"]
