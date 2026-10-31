"""ウィザード候補の結合テスト。外部 API は使わない。

画面の手順は 2 つだけ。背景を選び、同じ背景の上で紙面の性格を選ぶ。配置・配色・
題名色は選ばせない（描画側が決める）。
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from src.adapters.candidate_source.dalle_candidate_source import DalleCandidateSource
from src.adapters.candidate_source.placeholder_candidate_source import (
    PlaceholderCandidateSource,
)
from src.adapters.image_generator.mock_image_generator import MockImageGenerator
from src.infrastructure.config import Settings
from src.infrastructure.quota.memory_ai_quota import MemoryAiGenerationQuota
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
    )


def _body(**overrides: object) -> dict[str, object]:
    payload = make_request().model_dump(mode="json")
    payload.update(overrides)
    return payload


def _image(client: TestClient, url: str) -> Image.Image:
    response = client.get(url)
    assert response.status_code == 200
    return Image.open(BytesIO(response.content))


def _background(client: TestClient, **overrides: object) -> dict[str, object]:
    backgrounds = client.post(
        "/api/v1/flyers/candidates",
        json=_body(count=1, **overrides),
    ).json()["candidates"]
    assert len(backgrounds) == 1
    return backgrounds[0]


def _types(client: TestClient, parent_id: object) -> list[dict[str, object]]:
    return client.post(
        f"/api/v1/flyers/candidates/{parent_id}/types",
        json={},
    ).json()["candidates"]


def test_background_step_returns_one_tile(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        backgrounds = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()["candidates"]
        assert len(backgrounds) == 1
        assert backgrounds[0]["kind"] == "background"
        image = _image(client, backgrounds[0]["image_url"])
        assert image.size == (1080, 1528)


def test_type_step_renders_three_papers_on_the_same_background(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = _background(client)
        response = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/types",
            json={},
        )
        assert response.status_code == 200
        candidates = response.json()["candidates"]
        assert len(candidates) == 3
        assert {item["template_id"] for item in candidates} == {
            "style_1_bar_stylish",
            "style_2_warm_earth",
            "style_3_vibrant_pop",
        }
        assert all(item["kind"] == "type" for item in candidates)
        # 選んだ背景の上に焼き直す。配置は標準で固定。
        assert all(item["layout_id"] == "classic" for item in candidates)
        stored = client.app.state.candidate_store  # type: ignore[attr-defined]
        parent = stored.load_background(background["candidate_id"])
        for item in candidates:
            assert stored.load_background(item["candidate_id"]) == parent
            image = _image(client, item["image_url"])
            assert image.size == (1080, 1528)


def test_wizard_chain_produces_a_selectable_candidate(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = _background(client)
        types = _types(client, background["candidate_id"])
        chosen = types[1]
        assert chosen["template_id"] == "style_2_warm_earth"

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


def test_placeholder_backgrounds_report_source_and_remaining(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        payload = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()
        backgrounds = payload["candidates"]
        assert len(backgrounds) == 1
        assert backgrounds[0]["source"] == "placeholder"
        # AI が無効でも残り枚数の枠は返す（画面がボタンを出せるように）。
        assert backgrounds[0]["ai_remaining"] == 3
        # AI を使わない構成では代替へ落ちていない。
        assert payload["ai_fallback"] is False


class _FailingGenerator(MockImageGenerator):
    """生成に失敗したことにする生成器。AI は代替背景へ落ちる。"""

    used_fallback = True


def test_ai_failure_reports_the_fallback_to_the_client(tmp_path: Path) -> None:
    """AI で作れなかったことを、候補とは別に画面へ伝える。"""
    source = DalleCandidateSource(
        _FailingGenerator(),
        fallback=PlaceholderCandidateSource(),
        usd_jpy_rate=200.0,
        max_cost_jpy=9.5,
    )
    quota = MemoryAiGenerationQuota(3, 3600)
    app = create_app(_settings(tmp_path), candidate_source=source, ai_quota=quota)
    with TestClient(app) as client:
        payload = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()
    assert payload["candidates"][0]["source"] == "placeholder"
    assert payload["ai_fallback"] is True


def test_ai_backgrounds_stop_after_three_per_hour(tmp_path: Path) -> None:
    source = DalleCandidateSource(
        MockImageGenerator(),
        fallback=PlaceholderCandidateSource(),
        usd_jpy_rate=200.0,
        max_cost_jpy=9.5,
    )
    quota = MemoryAiGenerationQuota(3, 3600)
    app = create_app(_settings(tmp_path), candidate_source=source, ai_quota=quota)
    with TestClient(app) as client:
        seen: list[tuple[str, int | None]] = []
        fallbacks: list[bool] = []
        for _ in range(4):
            payload = client.post(
                "/api/v1/flyers/candidates",
                json=_body(count=1),
            ).json()
            candidate = payload["candidates"][0]
            seen.append((candidate["source"], candidate["ai_remaining"]))
            fallbacks.append(payload["ai_fallback"])

        # 初回と作り直し 2 回までは AI。4 回目はグラデーションへ落ちる。
        assert seen[:3] == [("ai", 2), ("ai", 1), ("ai", 0)]
        assert seen[3] == ("placeholder", 0)
        # 上限に達した回だけ、代替へ落ちたことを伝える。
        assert fallbacks == [False, False, False, True]


def test_type_candidates_inherit_source(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = _background(client)
        types = _types(client, background["candidate_id"])
        # 紙面の性格も供給元を引き継ぐ。
        assert {item["source"] for item in types} == {"placeholder"}


def test_unknown_candidate_returns_404(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        missing = client.post(
            f"/api/v1/flyers/candidates/{uuid4()}/types",
            json={},
        )
        broken = client.post(
            "/api/v1/flyers/candidates/not-a-uuid/types",
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


def test_type_step_is_one_axis_with_shared_ground_and_accent(tmp_path: Path) -> None:
    """3 枚は地も差し色も同じ。違うのは書体と寄せだけで、そこを比べさせる。"""
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = _background(client, semantic_theme="parchment")
        candidates = _types(client, background["candidate_id"])
        assert [item["label"] for item in candidates] == ["静けさ", "やわらかさ", "にぎやかさ"]
        assert len({item["palette_id"] for item in candidates}) == 1
        assert len({item["accent_color"] for item in candidates}) == 1
        # 前段で選んだテーマの差し色をそのまま使う。
        assert candidates[0]["accent_color"] == "#8B2635"
        stored = client.app.state.candidate_store  # type: ignore[attr-defined]
        grounds = {stored.load_background(item["candidate_id"]) for item in candidates}
        assert len(grounds) == 1


def test_type_step_recommends_only_the_themed_paper(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        parchment = _types(
            client,
            _background(client, semantic_theme="parchment")["candidate_id"],
        )
        plain = _types(client, _background(client)["candidate_id"])
    assert [item["recommended"] for item in parchment] == [True, False, False]
    assert all(item["recommended"] is False for item in plain)


def test_type_descriptions_do_not_name_venues_or_colours(tmp_path: Path) -> None:
    """色はテーマが決める。会場名や色名を混ぜると、選ぶ軸がぶれる。"""
    forbidden = ("バー", "フェス", "サロン", "暗い", "明るい", "鮮やか", "ゴールド")
    with TestClient(create_app(_settings(tmp_path))) as client:
        candidates = _types(client, _background(client)["candidate_id"])
    for item in candidates:
        text = f"{item['label']}{item['description']}"
        assert not any(word in text for word in forbidden), text


def test_type_candidates_belong_to_their_owner(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
            headers={"X-Flyer-Owner": "owner-a"},
        ).json()["candidates"][0]
        url = f"/api/v1/flyers/candidates/{background['candidate_id']}/types"
        assert (
            client.post(url, json={}, headers={"X-Flyer-Owner": "owner-a"}).status_code
            == 200
        )
        assert (
            client.post(url, json={}, headers={"X-Flyer-Owner": "owner-b"}).status_code
            == 404
        )
