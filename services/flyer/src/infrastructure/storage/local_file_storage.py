"""生成画像の原子的保存と TTL クリーンアップ。"""

from __future__ import annotations

import os
import re
import shutil
import time
from pathlib import Path
from uuid import uuid4

from src.domain.exceptions import InputValidationError
from src.ports.storage_port import StoragePort

_FILE_ID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_MANAGED_SUFFIXES = {".jpg", ".jpeg", ".png"}


class LocalFileStorage(StoragePort):
    """`{uuid}.jpg` を公開 URI と対応づけて保持する。"""

    def __init__(
        self,
        directory: Path,
        public_url_prefix: str = "/api/v1/flyers",
        free_ratio_threshold: float = 0.10,
    ) -> None:
        self._directory = directory
        self._directory.mkdir(parents=True, exist_ok=True)
        self._public_url_prefix = public_url_prefix.rstrip("/")
        self._free_ratio_threshold = free_ratio_threshold

    def save_temporary(self, file_id: str, image_bytes: bytes) -> str:
        self._require_file_id(file_id)
        destination = self._path_for(file_id)
        temporary = destination.with_name(f".{file_id}.tmp.{uuid4().hex}")
        temporary.write_bytes(image_bytes)
        os.replace(temporary, destination)
        return f"{self._public_url_prefix}/{file_id}"

    def load(self, file_id: str) -> bytes:
        self._require_file_id(file_id)
        path = self._path_for(file_id)
        if not path.is_file():
            raise FileNotFoundError(file_id)
        return path.read_bytes()

    def cleanup_expired(self, ttl_seconds: int) -> int:
        removed = self._delete_older_than(ttl_seconds)
        removed += self.purge_if_disk_low()
        return removed

    def purge_if_disk_low(self) -> int:
        """空き容量が閾値未満なら、更新が古いファイルから捨てる。"""
        if not self._is_disk_low():
            return 0
        removed = 0
        for path in self._image_files():
            if not self._is_disk_low():
                break
            path.unlink(missing_ok=True)
            removed += 1
        return removed

    def _delete_older_than(self, ttl_seconds: int) -> int:
        now = time.time()
        removed = 0
        for path in list(self._directory.iterdir()):
            if not path.is_file() or not self._is_managed(path):
                continue
            if now - path.stat().st_mtime >= ttl_seconds:
                path.unlink(missing_ok=True)
                removed += 1
        return removed

    def _image_files(self) -> list[Path]:
        files = [path for path in self._directory.glob("*.jpg") if path.is_file()]
        files.sort(key=lambda path: path.stat().st_mtime)
        return files

    def _is_disk_low(self) -> bool:
        usage = shutil.disk_usage(self._directory)
        if usage.total <= 0:
            return False
        return (usage.free / usage.total) < self._free_ratio_threshold

    def _path_for(self, file_id: str) -> Path:
        return self._directory / f"{file_id}.jpg"

    def _require_file_id(self, file_id: str) -> None:
        if _FILE_ID.fullmatch(file_id) is None:
            raise InputValidationError("file_id が不正です")

    @staticmethod
    def _is_managed(path: Path) -> bool:
        if path.suffix.lower() in _MANAGED_SUFFIXES:
            return True
        return ".tmp." in path.name
