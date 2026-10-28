"""プロセス内メモリで AI 背景の回数を数える。

`candidate_ttl_seconds` と同じ窓で数える。プロセスを再起動すると 0 に戻る。
水平分割するときは、同じポートのファイル実装か DB 実装へ差し替える。
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from src.ports.ai_generation_quota_port import AiGenerationQuotaPort

#: 端末トークンを持たない候補（所有者ヘッダー無し）をまとめるキー。
_ANONYMOUS_KEY = "*"


class MemoryAiGenerationQuota(AiGenerationQuotaPort):
    """端末ごとの使用時刻を保持し、窓の外に出た分は捨てる。"""

    def __init__(
        self,
        limit: int,
        window_seconds: int,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._limit = max(0, limit)
        self._window = max(0, window_seconds)
        self._clock = clock or time.monotonic
        self._used: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    @property
    def limit(self) -> int:
        return self._limit

    def remaining(self, owner_token_hash: str | None) -> int:
        with self._lock:
            stamps = self._prune(_key(owner_token_hash))
            return max(0, self._limit - len(stamps))

    def consume(self, owner_token_hash: str | None, count: int = 1) -> None:
        if count <= 0:
            return
        with self._lock:
            key = _key(owner_token_hash)
            stamps = self._prune(key)
            stamps.extend([self._clock()] * count)
            self._used[key] = stamps

    def _prune(self, key: str) -> list[float]:
        """窓より古い記録を捨てて、残っている使用時刻を返す。"""
        now = self._clock()
        stamps = [stamp for stamp in self._used.get(key, []) if now - stamp < self._window]
        if stamps:
            self._used[key] = stamps
        else:
            self._used.pop(key, None)
        return stamps


def _key(owner_token_hash: str | None) -> str:
    value = (owner_token_hash or "").strip()
    return value or _ANONYMOUS_KEY


__all__ = ["MemoryAiGenerationQuota"]
