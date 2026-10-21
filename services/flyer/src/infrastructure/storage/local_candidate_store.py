"""ウィザード候補の一時保存。

1 候補につき 3 ファイルを持つ。

- `{id}.jpg`       … 文字まで合成した完成イメージ（タイル表示と確定に使う）
- `{id}.src.png`   … 合成前の背景。子候補（配置・配色）を描き直すために要る
- `{id}.json`      … `CandidateMeta`。親子関係と描画条件を残す

背景を残さず完成 JPEG だけ持つと、配置や配色を変えるたびに背景を作り直す
ことになる。プレースホルダなら無料だが、AI 背景に替えると 1 枚 8 円かかる。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
from pathlib import Path
from uuid import uuid4

from src.domain.exceptions import CandidateNotFoundError, InputValidationError
from src.domain.models import CandidateMeta

_FILE_ID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class LocalCandidateStore:
    """ディレクトリ 1 つに候補一式を置く。`cleanup_expired` は mtime で消す。"""

    def __init__(
        self,
        directory: Path,
        public_url_prefix: str = "/api/v1/flyers/candidates",
    ) -> None:
        self._directory = directory
        self._directory.mkdir(parents=True, exist_ok=True)
        self._public_url_prefix = public_url_prefix.rstrip("/")

    @property
    def directory(self) -> Path:
        return self._directory

    def image_url(self, candidate_id: str) -> str:
        return f"{self._public_url_prefix}/{candidate_id}"

    def save(
        self,
        candidate_id: str,
        image_bytes: bytes,
        background_bytes: bytes,
        meta: CandidateMeta,
    ) -> str:
        """完成画像・背景・メタをまとめて書く。途中で落ちても半端を残さない。"""
        self._require_id(candidate_id)
        self._write_atomic(self._image_path(candidate_id), image_bytes)
        self._write_atomic(self._source_path(candidate_id), background_bytes)
        self._write_atomic(
            self._meta_path(candidate_id),
            meta.model_dump_json().encode("utf-8"),
        )
        return self.image_url(candidate_id)

    def load(self, candidate_id: str) -> bytes:
        self._require_id(candidate_id)
        path = self._image_path(candidate_id)
        if not path.is_file():
            raise CandidateNotFoundError(f"candidate {candidate_id} not found")
        return path.read_bytes()

    def load_meta(self, candidate_id: str) -> CandidateMeta:
        self._require_id(candidate_id)
        path = self._meta_path(candidate_id)
        if not path.is_file():
            raise CandidateNotFoundError(f"candidate {candidate_id} not found")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise CandidateNotFoundError(
                f"candidate {candidate_id} metadata is broken"
            ) from exc
        try:
            return CandidateMeta.model_validate(payload)
        except Exception as exc:
            raise CandidateNotFoundError(
                f"candidate {candidate_id} metadata is invalid"
            ) from exc

    def load_background(self, candidate_id: str) -> bytes:
        self._require_id(candidate_id)
        path = self._source_path(candidate_id)
        if not path.is_file():
            raise CandidateNotFoundError(f"candidate {candidate_id} background is gone")
        return path.read_bytes()

    def cleanup_expired(self, ttl_seconds: int) -> int:
        """メタ、背景、完成画像のいずれかが古ければ 3 つまとめて消す。"""
        now = time.time()
        removed = 0
        for path in list(self._directory.iterdir()):
            if not path.is_file() or path.suffix.lower() not in {".jpg", ".png", ".json"}:
                continue
            if now - path.stat().st_mtime < ttl_seconds:
                continue
            candidate_id = path.name.split(".", 1)[0]
            for target in (
                self._image_path(candidate_id),
                self._source_path(candidate_id),
                self._meta_path(candidate_id),
            ):
                if target.is_file():
                    target.unlink(missing_ok=True)
            removed += 1
        return removed

    def purge_all(self) -> int:
        """テストと非常時用。ディレクトリ内の候補を全消しする。"""
        if self._directory.is_dir():
            shutil.rmtree(self._directory, ignore_errors=True)
            self._directory.mkdir(parents=True, exist_ok=True)
        return 0

    def _write_atomic(self, destination: Path, payload: bytes) -> None:
        temporary = destination.with_name(f".{destination.name}.tmp.{uuid4().hex}")
        temporary.write_bytes(payload)
        os.replace(temporary, destination)

    def _image_path(self, candidate_id: str) -> Path:
        return self._directory / f"{candidate_id}.jpg"

    def _source_path(self, candidate_id: str) -> Path:
        return self._directory / f"{candidate_id}.src.png"

    def _meta_path(self, candidate_id: str) -> Path:
        return self._directory / f"{candidate_id}.json"

    @staticmethod
    def _require_id(candidate_id: str) -> None:
        if _FILE_ID.fullmatch(candidate_id) is None:
            raise InputValidationError("candidate_id が不正です")


__all__ = ["LocalCandidateStore"]
