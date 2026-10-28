"""AI 背景候補の回数枠。

有料の画像生成は、1 端末・1 時間あたりの枚数で抑える。確定時の回数
（Next.js の `flyer_generation_logs`）とは別に数える。候補の段階でも課金が
起きるため、ここで上限を持たないと原価が読めない。
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class AiGenerationQuotaPort(ABC):
    """AI で作れる背景の残り枚数を返し、使った枚数を記録する。"""

    @abstractmethod
    def remaining(self, owner_token_hash: str | None) -> int:
        """この端末があと何枚 AI 背景を作れるか。"""

    @abstractmethod
    def consume(self, owner_token_hash: str | None, count: int = 1) -> None:
        """使った枚数を記録する。負の値は無視する。"""


__all__ = ["AiGenerationQuotaPort"]
