"""一時画像ストレージのポート。"""

from __future__ import annotations

from abc import ABC, abstractmethod


class StoragePort(ABC):
    """生成画像の一時保存と期限切れ削除。"""

    @abstractmethod
    def save_temporary(self, file_id: str, image_bytes: bytes) -> str:
        """一時ストレージへ原子的に保存し、公開 URI を返す。"""

    @abstractmethod
    def load(self, file_id: str) -> bytes:
        """保存済み画像バイト列を読み出す。存在しなければ FileNotFoundError。"""

    @abstractmethod
    def cleanup_expired(self, ttl_seconds: int) -> int:
        """期限切れキャッシュを破棄し、削除件数を返す。"""
