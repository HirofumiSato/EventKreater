"""ウィザード候補の結合テスト。外部 API は使わない。"""

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


def test_placeholder_backgrounds_report_source_and_remaining(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        backgrounds = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()["candidates"]
        assert len(backgrounds) == 1
        assert backgrounds[0]["source"] == "placeholder"
        # AI が無効でも残り枚数の枠は返す（画面がボタンを出せるように）。
        assert backgrounds[0]["ai_remaining"] == 3


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
        for _ in range(4):
            candidate = client.post(
                "/api/v1/flyers/candidates",
                json=_body(count=1),
            ).json()["candidates"][0]
            seen.append((candidate["source"], candidate["ai_remaining"]))

        # 初回と作り直し 2 回までは AI。4 回目はグラデーションへ落ちる。
        assert seen[:3] == [("ai", 2), ("ai", 1), ("ai", 0)]
        assert seen[3] == ("placeholder", 0)


def test_layout_candidates_inherit_source(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()["candidates"][0]
        layouts = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/layouts",
            json={},
        ).json()["candidates"]
        # 配置・配色の候補も供給元を引き継ぐ。
        assert {item["source"] for item in layouts} == {"placeholder"}


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


def test_type_step_is_one_axis_with_shared_ground_and_accent(tmp_path: Path) -> None:
    """3 枚は地も差し色も同じ。違うのは書体と寄せだけで、そこを比べさせる。"""
    with TestClient(create_app(_settings(tmp_path))) as client:
        candidates = client.post(
            "/api/v1/flyers/candidates/types",
            json=_body(semantic_theme="parchment"),
        ).json()["candidates"]
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
        parchment = client.post(
            "/api/v1/flyers/candidates/types",
            json=_body(semantic_theme="parchment"),
        ).json()["candidates"]
        plain = client.post(
            "/api/v1/flyers/candidates/types",
            json=_body(),
        ).json()["candidates"]
    assert [item["recommended"] for item in parchment] == [True, False, False]
    assert all(item["recommended"] is False for item in plain)


def test_type_descriptions_do_not_name_venues_or_colours(tmp_path: Path) -> None:
    """色はテーマが決める。会場名や色名を混ぜると、選ぶ軸がぶれる。"""
    forbidden = ("バー", "フェス", "サロン", "暗い", "明るい", "鮮やか", "ゴールド")
    with TestClient(create_app(_settings(tmp_path))) as client:
        candidates = client.post(
            "/api/v1/flyers/candidates/types",
            json=_body(),
        ).json()["candidates"]
    for item in candidates:
        text = f"{item['label']}{item['description']}"
        assert not any(word in text for word in forbidden), text


def test_palette_step_starts_with_the_colour_already_chosen(tmp_path: Path) -> None:
    """ステップ 3 で見た色が、ステップ 4 の先頭に来る。確定時に色が飛ばない。"""
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = client.post(
            "/api/v1/flyers/candidates",
            json=_body(template_id="style_2_warm_earth", count=1),
        ).json()["candidates"][0]
        # テーマ無しでは従来の 4 色を並べ替えて返す。
        palettes = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/palettes",
            json={},
        ).json()["candidates"]
        assert palettes[0]["palette_id"] == background["palette_id"] == "earth"
        assert {item["palette_id"] for item in palettes} == {
            "gold",
            "mono",
            "neon",
            "earth",
        }

        themed = client.post(
            "/api/v1/flyers/candidates",
            json=_body(semantic_theme="neon", count=1),
        ).json()["candidates"][0]
        themed_palettes = client.post(
            f"/api/v1/flyers/candidates/{themed['candidate_id']}/palettes",
            json={},
        ).json()["candidates"]
    assert [item["palette_id"] for item in themed_palettes] == [
        "theme",
        "theme-soft",
        "theme-deep",
        "theme-quiet",
    ]
    assert themed_palettes[0]["accent_color"] == themed["accent_color"]


def test_title_colour_step_offers_auto_ink_white_and_accent(tmp_path: Path) -> None:
    """ステップ 5。先頭は自動で、墨・白・差し色の 4 枚を返す。"""
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()["candidates"][0]
        palettes = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/palettes",
            json={},
        ).json()["candidates"]
        colours = client.post(
            f"/api/v1/flyers/candidates/{palettes[0]['candidate_id']}/title-colors",
            json={},
        ).json()["candidates"]

        assert len(colours) == 4
        assert {item["kind"] for item in colours} == {"title_color"}
        assert [item["label"] for item in colours] == ["自動", "墨", "白", "差し色"]
        assert colours[0]["title_color"] is None
        assert colours[2]["title_color"] == "#FFFFFF"
        # 差し色は紙に対して 4.5:1 へ寄せた値。パレットの生の値ではない。
        accent = colours[3]["title_color"]
        assert accent is not None and accent.startswith("#")
        assert accent not in {colours[1]["title_color"], "#FFFFFF"}
        for item in colours:
            image = _image(client, item["image_url"])
            assert image.size == (1080, 1528)

        store = client.app.state.candidate_store  # type: ignore[attr-defined]
        assert store.load_meta(colours[1]["candidate_id"]).title_color_id == "ink"


def test_a_chosen_title_colour_is_saved_as_previewed(tmp_path: Path) -> None:
    """選んだ 1 枚がそのまま完成品になる。確定時に描き直さない。"""
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
        ).json()["candidates"][0]
        palettes = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/palettes",
            json={},
        ).json()["candidates"]
        chosen = client.post(
            f"/api/v1/flyers/candidates/{palettes[0]['candidate_id']}/title-colors",
            json={},
        ).json()["candidates"][2]

        preview = client.get(chosen["image_url"]).content
        saved = client.post(
            "/api/v1/flyers/generate",
            json=_body(candidate_id=chosen["candidate_id"]),
        )
        assert saved.status_code == 200
        assert client.get(saved.json()["image_url"]).content == preview


def test_title_colour_candidates_belong_to_their_owner(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as client:
        background = client.post(
            "/api/v1/flyers/candidates",
            json=_body(count=1),
            headers={"X-Flyer-Owner": "owner-a"},
        ).json()["candidates"][0]
        palettes = client.post(
            f"/api/v1/flyers/candidates/{background['candidate_id']}/palettes",
            json={},
            headers={"X-Flyer-Owner": "owner-a"},
        ).json()["candidates"]
        url = f"/api/v1/flyers/candidates/{palettes[0]['candidate_id']}/title-colors"
        assert (
            client.post(url, json={}, headers={"X-Flyer-Owner": "owner-a"}).status_code
            == 200
        )
        assert (
            client.post(url, json={}, headers={"X-Flyer-Owner": "owner-b"}).status_code
            == 404
        )
