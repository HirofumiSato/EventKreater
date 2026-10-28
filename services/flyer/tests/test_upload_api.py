"""自分の写真を背景候補にする API の結合テスト。"""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from src.infrastructure.config import Settings
from src.main import create_app
from tests.support import make_request

OWNER = "a" * 64
OTHER = "b" * 64


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


def _body() -> dict[str, object]:
    return make_request().model_dump(mode="json")


def _jpeg(width: int = 800, height: int = 400) -> bytes:
    image = Image.new("RGB", (width, height), (120, 30, 40))
    exif = image.getexif()
    exif[271] = "TestCamera"
    exif[274] = 6  # 90 度回して縦にする。
    buffer = BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def _upload(
    client: TestClient,
    payload: bytes,
    *,
    owner: str = OWNER,
    filename: str = "photo.jpg",
    content_type: str = "image/jpeg",
):
    return client.post(
        "/api/v1/backgrounds",
        files={"file": (filename, payload, content_type)},
        data={"payload": json.dumps(_body())},
        headers={"X-Flyer-Owner": owner},
    )


def test_upload_becomes_background_candidate(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        response = _upload(client, _jpeg())
        assert response.status_code == 200
        candidate = response.json()
        assert candidate["kind"] == "background"
        assert candidate["label"] == "自分の写真"

        image = Image.open(
            BytesIO(
                client.get(
                    candidate["image_url"],
                    headers={"X-Flyer-Owner": OWNER},
                ).content
            )
        )
        assert image.size == (1080, 1528)

        store = client.app.state.candidate_store  # type: ignore[attr-defined]
        meta = store.load_meta(candidate["candidate_id"])
        assert meta.source == "upload"
        assert meta.owner_token_hash == OWNER

        # 保存する背景は PNG で、EXIF を持たない。
        background = Image.open(BytesIO(store.load_background(candidate["candidate_id"])))
        assert background.format == "PNG"
        assert background.size == (1080, 1528)
        assert len(background.getexif()) == 0


def test_upload_candidate_is_limited_to_its_owner(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        candidate = _upload(client, _jpeg()).json()
        url = candidate["image_url"]

        assert client.get(url, headers={"X-Flyer-Owner": OWNER}).status_code == 200
        assert client.get(url, headers={"X-Flyer-Owner": OTHER}).status_code == 404
        assert client.get(url).status_code == 404

        layouts_url = f"/api/v1/flyers/candidates/{candidate['candidate_id']}/layouts"
        assert (
            client.post(layouts_url, json={}, headers={"X-Flyer-Owner": OTHER}).status_code
            == 404
        )
        allowed = client.post(
            layouts_url,
            json={},
            headers={"X-Flyer-Owner": OWNER},
        )
        assert allowed.status_code == 200
        assert len(allowed.json()["candidates"]) == 4


def test_uploaded_background_flows_through_layouts_palettes_and_save(
    tmp_path: Path,
) -> None:
    """配置・配色を選び直しても、保存結果が最後のプレビューと一致する。"""
    with TestClient(create_app(_settings(tmp_path))) as client:
        owner = {"X-Flyer-Owner": OWNER}
        uploaded = _upload(client, _jpeg()).json()

        layouts = client.post(
            f"/api/v1/flyers/candidates/{uploaded['candidate_id']}/layouts",
            json={},
            headers=owner,
        ).json()["candidates"]
        assert len(layouts) == 4

        palettes = client.post(
            f"/api/v1/flyers/candidates/{layouts[0]['candidate_id']}/palettes",
            json={},
            headers=owner,
        ).json()["candidates"]
        assert len(palettes) == 4

        chosen = palettes[0]
        preview = client.get(chosen["image_url"], headers=owner).content
        saved = client.post(
            "/api/v1/flyers/generate",
            json={**_body(), "candidate_id": chosen["candidate_id"]},
            headers=owner,
        )
        assert saved.status_code == 200
        stored = client.get(saved.json()["image_url"])
        assert stored.status_code == 200
        # 確定は再描画せず、候補の JPEG をそのまま複写する。
        assert stored.content == preview


def test_unsupported_format_is_rejected(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        gif = BytesIO()
        Image.new("RGB", (40, 40), (0, 0, 0)).save(gif, format="GIF")
        response = _upload(client, gif.getvalue(), filename="photo.gif", content_type="image/gif")
        assert response.status_code == 422
        assert response.json()["error_code"] == "INVALID_IMAGE"


def test_broken_image_is_rejected(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        response = _upload(client, b"\xff\xd8\xff not really a jpeg")
        assert response.status_code == 422
        assert response.json()["error_code"] == "INVALID_IMAGE"


def test_too_large_image_is_rejected(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path, upload_max_bytes=1024))) as client:
        response = _upload(client, _jpeg(width=600, height=600))
        assert response.status_code == 413
        assert response.json()["error_code"] == "UPLOAD_TOO_LARGE"
