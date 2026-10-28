"""1 回の生成の原価が 10 円未満であることを固定する。

価格表（`src/domain/pricing.py`）を書き換えたり、為替が動いたりしたときに、ここで
落ちて気づけるようにする。数値は「1 ウィザード 1 周 = 初回 1 枚 + 作り直し 2 枚」。
"""

from __future__ import annotations

import pytest

from src.domain.pricing import (
    DEFAULT_IMAGE_MODEL,
    DEFAULT_IMAGE_QUALITY,
    DEFAULT_IMAGE_SIZE,
    DEFAULT_MAX_COST_JPY_PER_REQUEST,
    STRESS_USD_JPY_RATE,
    estimate_image_cost_jpy,
    estimate_wizard_cost_jpy,
    image_price_usd,
)

#: ゴール。1 回の生成あたりの原価の上限（円）。
TARGET_JPY_PER_REQUEST: float = 10.0

#: 1 ウィザードで AI が作る背景の枚数（初回 1 + 作り直し 2）。
WIZARD_IMAGE_COUNT: int = 3

#: その周回で走る LLM の回数（ステップ 1 の 1 回 + 背景のたびの 1 回）。
WIZARD_LLM_CALLS: int = 4


def _wizard_cost(usd_jpy_rate: float) -> float:
    return estimate_wizard_cost_jpy(
        WIZARD_IMAGE_COUNT,
        model=DEFAULT_IMAGE_MODEL,
        quality=DEFAULT_IMAGE_QUALITY,
        size=DEFAULT_IMAGE_SIZE,
        usd_jpy_rate=usd_jpy_rate,
        llm_calls=WIZARD_LLM_CALLS,
    )


def test_wizard_worst_case_is_under_ten_yen() -> None:
    # 円安側（1 USD = 200 円）で見積もる。
    assert _wizard_cost(STRESS_USD_JPY_RATE) < TARGET_JPY_PER_REQUEST


def test_wizard_cost_at_stronger_yen_is_even_lower() -> None:
    assert _wizard_cost(150.0) < _wizard_cost(STRESS_USD_JPY_RATE)


def test_single_image_cost_is_about_one_yen() -> None:
    unit = estimate_image_cost_jpy(
        DEFAULT_IMAGE_MODEL,
        DEFAULT_IMAGE_QUALITY,
        DEFAULT_IMAGE_SIZE,
        STRESS_USD_JPY_RATE,
    )
    # 1024x1536 / low は $0.005（公式の換算 $0.00474 を切り上げ）。1 USD = 200 円。
    assert unit == pytest.approx(1.0)
    assert unit < 2.0


def test_yen_rate_that_breaks_the_target_is_known() -> None:
    """損益分岐の為替を明示しておく。ここを超えると 10 円を超える。"""
    unit_usd = (
        image_price_usd(DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, DEFAULT_IMAGE_SIZE)
        * WIZARD_IMAGE_COUNT
    )
    # 画像 3 枚だけで 10 円に届く為替。
    break_even = TARGET_JPY_PER_REQUEST / unit_usd
    assert break_even > 200.0
    assert break_even == pytest.approx(666.7, abs=0.1)

    with pytest.raises(AssertionError):
        assert _wizard_cost(break_even + 10.0) < TARGET_JPY_PER_REQUEST


def test_default_request_cap_leaves_headroom_below_ten_yen() -> None:
    assert DEFAULT_MAX_COST_JPY_PER_REQUEST < TARGET_JPY_PER_REQUEST
    # 1 枚ずつ作るので、上限に当たらずに 3 枚まで作れる。
    unit = estimate_image_cost_jpy(
        DEFAULT_IMAGE_MODEL,
        DEFAULT_IMAGE_QUALITY,
        DEFAULT_IMAGE_SIZE,
        STRESS_USD_JPY_RATE,
    )
    assert unit < DEFAULT_MAX_COST_JPY_PER_REQUEST
    assert unit * 2 <= DEFAULT_MAX_COST_JPY_PER_REQUEST
