"""生成からダウンロードまでの結合テスト。外部 API は使わない。"""

from __future__ import annotations

import os
from collections import namedtuple
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.domain.exceptions import (
    FontRenderError,
    ImageGenerationTimeoutError,
    LLMContextGenerationError,
)
from src.domain.models import FlyerGenerationRequest, LLMGenerationContext, TemplateId
from src.infrastructure.config import Settings
from src.infrastructure.storage.local_file_storage import LocalFileStorage
from src.main import create_app
from tests.support import make_request

_Usage = namedtuple("Usage", "total used free")


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "openai_api_key": None,
        "storage_dir": tmp_path / "tmp",
        "fallback_dir": tmp_path / "backgrounds",
        "candidate_dir": tmp_path / "candidates",
        "ttl_seconds": 3600,
        "candidate_ttl_seconds": 3600,
        "cleanup_interval_seconds": 600,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def _client(tmp_path: Path, **kwargs: object) -> TestClient:
    application = create_app(_settings(tmp_path), **kwargs)  # type: ignore[arg-type]
    return TestClient(application)


def test_generate_then_download_portrait_jpeg(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok"}
        docs = client.get("/docs")
        assert docs.status_code == 200

        response = client.post(
            "/api/v1/flyers/generate",
            json=make_request().model_dump(mode="json"),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "success"
        assert body["generation_id"]
        assert body["image_url"] == f"/api/v1/flyers/{body['generation_id']}"

        download = client.get(body["image_url"])
        assert download.status_code == 200
        assert download.headers["content-type"].startswith("image/jpeg")
        image = Image.open(BytesIO(download.content))
        assert image.size == (1080, 1920)


def test_invalid_input_returns_422(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.post(
            "/api/v1/flyers/generate",
            json={"title": "あ", "template_id": "style_1_bar_stylish"},
        )
    assert response.status_code == 422
    assert response.json() == {
        "error_code": "INVALID_INPUT",
        "message": "入力内容を確認してください（文字数超過など）",
    }


def test_llm_failure_returns_503(tmp_path: Path) -> None:
    class FailingPrompt:
        async def generate_prompt_context(
            self,
            request: FlyerGenerationRequest,
        ) -> LLMGenerationContext:
            raise LLMContextGenerationError("openai unavailable")

    application = create_app(_settings(tmp_path), prompt_engine=FailingPrompt())
    with TestClient(application) as client:
        response = client.post(
            "/api/v1/flyers/generate",
            json=make_request().model_dump(mode="json"),
        )
    assert response.status_code == 503
    assert response.json() == {
        "error_code": "LLM_SERVICE_UNAVAILABLE",
        "message": "システム混雑のため処理を開始できませんでした。再試行してください",
    }


def test_image_timeout_uses_static_fallback(tmp_path: Path) -> None:
    class TimingOutImages:
        async def generate_background(
            self,
            prompt: str,
            negative_prompt: str,
            aspect_ratio: str = "9:16",
        ) -> bytes:
            raise ImageGenerationTimeoutError("deadline exceeded")

    application = create_app(
        _settings(tmp_path),
        image_generator=TimingOutImages(),
    )
    with TestClient(application) as client:
        response = client.post(
            "/api/v1/flyers/generate",
            json=make_request(template_id=TemplateId.STYLE_2_WARM_EARTH).model_dump(mode="json"),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "fallback_used"
        download = client.get(body["image_url"])
        assert download.status_code == 200
        assert Image.open(BytesIO(download.content)).size == (1080, 1920)


def test_render_failure_returns_500(tmp_path: Path) -> None:
    class FailingRenderer:
        def render_flyer(
            self,
            background_bytes: bytes,
            request: FlyerGenerationRequest,
            context: LLMGenerationContext,
        ) -> bytes:
            raise FontRenderError("font broken")

    application = create_app(_settings(tmp_path), renderer=FailingRenderer())
    with TestClient(application) as client:
        response = client.post(
            "/api/v1/flyers/generate",
            json=make_request().model_dump(mode="json"),
        )
    assert response.status_code == 500
    assert response.json() == {
        "error_code": "RENDER_FAILURE",
        "message": "画像の文字合成に失敗しました。管理者に問い合わせてください",
    }


def test_missing_and_invalid_flyer_ids(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        missing = client.get(f"/api/v1/flyers/{uuid4()}")
        invalid = client.get("/api/v1/flyers/not-a-uuid")
    assert missing.status_code == 404
    assert invalid.status_code == 422
    assert invalid.json()["error_code"] == "INVALID_INPUT"


def test_storage_ttl_and_atomic_write(tmp_path: Path) -> None:
    storage = LocalFileStorage(tmp_path)
    flyer_id = str(uuid4())
    url = storage.save_temporary(flyer_id, b"jpeg-bytes")
    assert url == f"/api/v1/flyers/{flyer_id}"
    assert storage.load(flyer_id) == b"jpeg-bytes"
    assert list(tmp_path.glob("*.tmp.*")) == []
    (tmp_path / "notes.txt").write_text("keep", encoding="utf-8")

    expired_id = str(uuid4())
    storage.save_temporary(expired_id, b"old")
    expired_path = tmp_path / f"{expired_id}.jpg"
    os.utime(expired_path, (1_700_000_000, 1_700_000_000))

    removed = storage.cleanup_expired(ttl_seconds=10)
    assert removed == 1
    assert not expired_path.exists()
    assert storage.load(flyer_id) == b"jpeg-bytes"
    assert (tmp_path / "notes.txt").is_file()


def test_emergency_purge_drops_oldest_files_when_disk_is_low(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = LocalFileStorage(tmp_path, free_ratio_threshold=0.10)
    older = str(uuid4())
    newer = str(uuid4())
    storage.save_temporary(older, b"old")
    storage.save_temporary(newer, b"new")
    os.utime(tmp_path / f"{older}.jpg", (1_700_000_000, 1_700_000_000))
    monkeypatch.setattr(
        "src.infrastructure.storage.local_file_storage.shutil.disk_usage",
        lambda path: _Usage(total=100, used=95, free=5),
    )
    removed = storage.cleanup_expired(ttl_seconds=10_000_000)
    assert removed == 2
    assert list(tmp_path.glob("*.jpg")) == []


def test_settings_ttl_matches_detailed_design() -> None:
    assert Settings(openai_api_key=None).ttl_seconds == 3600
