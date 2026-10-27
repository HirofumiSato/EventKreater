"""ウィザード候補の結合テスト。外部 API は使わない。"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from src.infrastructure.config import Settings
from src.main import create_app
from tests.support import make_request


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        openai_api_key=None,
        storage_dir=tmp_path / "tmp",
        fallback_dir=tmp_path / "backgrounds",
        candidate_dir=tmp_path / "candidates",
        ttl_seconds=3600,
        candidate_ttl_seconds=3600,
        cleanup_interval_seconds=600,
        candidate_count=8,
    )


def _body(**overrides: object) -> dict[str, object]:
    payload = make_request().model_dump(mode="json")
    payload.update(overrides)
    return payload


def _image(client: TestClient, url: str) -> Image.Image:
    response = client.get(url)
    assert response.status_code == 200
    return Image.open(BytesIO(response.content))


def test_type_step_returns_three_rendered_templates(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        response = client.post("/api/v1/flyers/candidates/types", json=_body())
        assert response.status_code == 200
        candidates = response.json()["candidates"]
        assert len(candidates) == 3
        assert {item["template_id"] for item in candidates} == {
            "style_1_bar_stylish",
            "style_2_warm_earth",
            "style_3_vibrant_pop",
        }
        assert all(item["kind"] == "type" for item in candidates)
        for item in candidates:
            image = _image(client, item["image_url"])
            assert image.size == (1080, 1528)


def test_wizard_chain_produces_selectable_candidate(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        backgrounds = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=3),
        ).json()["candidates"]
        assert len(backgrounds) == 3
        assert all(item["kind"] == "background" for item in backgrounds)
        background = backgrounds[1]

        layouts = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/layouts",
            json={},
        ).json()["candidates"]
        assert len(layouts) == 4
        assert {item["layout_id"] for item in layouts} == {
            "classic",
            "top_stack",
            "center_stack",
            "bottom_stack",
        }
        top_stack = next(item for item in layouts if item["layout_id"] == "top_stack")

        palettes = client.post(
            f"/api/v1/flyers/candidates/{top_stack['candidate_id']}/palettes",
            json={},
        ).json()["candidates"]
        assert len(palettes) == 4
        assert {item["palette_id"] for item in palettes} == {
            "gold",
            "mono",
            "neon",
            "earth",
        }
        chosen = palettes[0]
        assert chosen["template_id"] == background["template_id"]
        assert chosen["layout_id"] == "top_stack"

        before = client.get(chosen["image_url"]).content

        generated = client.post(
            "/api/v1/flyers/generate",
            json=_body(candidate_id=chosen["candidate_id"]),
        )
        assert generated.status_code == 200
        body = generated.json()
        assert body["status"] == "success"
        # 選んだタイルと完成品はバイト単位で一致する（再描画しない）。
        assert client.get(body["image_url"]).content == before


def test_layout_candidates_share_the_same_background(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()["candidates"][0]
        layouts = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/layouts",
            json={},
        ).json()["candidates"]
        stored = client.app.state.candidate_store  # type: ignore[attr-defined]
        sources = {
            stored.load_background(item["candidate_id"]) for item in layouts
        }
        assert len(sources) == 1


def test_unknown_candidate_returns_404(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        missing = client.post(
            f"/api/v1/flyers/candidates/{uuid4()}/layouts",
            json={},
        )
        broken = client.post(
            "/api/v1/flyers/candidates/not-a-uuid/layouts",
            json={},
        )
    assert missing.status_code == 404
    assert missing.json()["error_code"] == "CANDIDATE_EXPIRED"
    assert broken.status_code == 422
    assert broken.json()["error_code"] == "INVALID_INPUT"


def test_generate_rejects_expired_candidate(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        response = client.post(
            "/api/v1/flyers/generate",
            json=_body(candidate_id=str(uuid4())),
        )
    assert response.status_code == 404
    assert response.json()["error_code"] == "CANDIDATE_EXPIRED"
