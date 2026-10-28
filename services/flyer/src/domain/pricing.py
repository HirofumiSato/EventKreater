"""画像生成 API の価格表と、生成前のコスト見積り。

外部 SDK も I/O も持たない純粋な計算だけを置く。予算を守る判定はここを通すので、
価格改定や為替の変動があったときは、この表と `tests/test_cost_budget.py` の
両方を見直す。テストが落ちれば、原価が目標（1 回あたり 10 円未満）を超えたことに
気づける。

価格は OpenAI の公表価格（USD / 1 枚）の概算。実装前に現行の料金ページで確認する。
"""

from __future__ import annotations

#: 背景生成の標準構成。A4 縦（1080×1528）に切り抜いたときの欠落が最も小さい。
DEFAULT_IMAGE_MODEL: str = "gpt-image-1"
DEFAULT_IMAGE_QUALITY: str = "low"
DEFAULT_IMAGE_SIZE: str = "1024x1536"

#: 1 枚あたりの USD。表に無い組み合わせは安全側（そのモデルの最高額）へ倒す。
IMAGE_PRICES_USD: dict[tuple[str, str, str], float] = {
    ("gpt-image-1", "low", "1024x1536"): 0.016,
    ("gpt-image-1", "medium", "1024x1536"): 0.063,
    ("gpt-image-1", "high", "1024x1536"): 0.250,
    ("gpt-image-1", "low", "1536x1024"): 0.016,
    ("gpt-image-1", "medium", "1536x1024"): 0.063,
    ("gpt-image-1", "high", "1536x1024"): 0.250,
    ("gpt-image-1", "low", "1024x1024"): 0.011,
    ("gpt-image-1", "medium", "1024x1024"): 0.042,
    ("gpt-image-1", "high", "1024x1024"): 0.167,
    ("dall-e-3", "standard", "1024x1024"): 0.040,
    ("dall-e-3", "hd", "1024x1024"): 0.080,
    ("dall-e-3", "standard", "1024x1792"): 0.080,
    ("dall-e-3", "hd", "1024x1792"): 0.120,
    ("dall-e-3", "standard", "1792x1024"): 0.080,
    ("dall-e-3", "hd", "1792x1024"): 0.120,
}

#: 表に無いモデル・組み合わせのときに使う上限額。見積りは過小に出さない。
_FALLBACK_IMAGE_USD: float = 0.250

#: LLM 1 回（入力 200 / 出力 300 トークン程度）の USD。安全側に丸める。
LLM_CALL_USD: float = 0.0003

#: 価格表の更新漏れを検知するための基準通貨レート（1 USD = 200 円）。
STRESS_USD_JPY_RATE: float = 200.0

#: 1 回の生成（ウィザード 1 周）で守る上限。10 円未満に 5% の余裕を残す。
DEFAULT_MAX_COST_JPY_PER_REQUEST: float = 9.5


def image_price_usd(model: str, quality: str, size: str) -> float:
    """画像 1 枚の単価（USD）。未知の組み合わせは安全側の額を返す。"""
    exact = IMAGE_PRICES_USD.get((model, quality, size))
    if exact is not None:
        return exact
    return _FALLBACK_IMAGE_USD


def estimate_image_cost_jpy(
    model: str,
    quality: str,
    size: str,
    usd_jpy_rate: float,
) -> float:
    """画像 1 枚の原価（円）。"""
    return image_price_usd(model, quality, size) * usd_jpy_rate


def estimate_llm_cost_jpy(llm_calls: int, usd_jpy_rate: float) -> float:
    """プロンプト生成の原価（円）。`llm_calls` は LLM の呼び出し回数。"""
    return LLM_CALL_USD * max(0, llm_calls) * usd_jpy_rate


def estimate_wizard_cost_jpy(
    image_count: int,
    *,
    model: str = DEFAULT_IMAGE_MODEL,
    quality: str = DEFAULT_IMAGE_QUALITY,
    size: str = DEFAULT_IMAGE_SIZE,
    usd_jpy_rate: float = STRESS_USD_JPY_RATE,
    llm_calls: int = 4,
) -> float:
    """ウィザード 1 周の原価（円）。

    `image_count` は AI で作る背景の枚数、`llm_calls` はその周回で走る LLM の回数
    （ステップ 1 の 1 回と、背景候補のたびの 1 回）。
    """
    images = max(0, image_count) * estimate_image_cost_jpy(
        model,
        quality,
        size,
        usd_jpy_rate,
    )
    return images + estimate_llm_cost_jpy(llm_calls, usd_jpy_rate)


__all__ = [
    "DEFAULT_IMAGE_MODEL",
    "DEFAULT_IMAGE_QUALITY",
    "DEFAULT_IMAGE_SIZE",
    "DEFAULT_MAX_COST_JPY_PER_REQUEST",
    "IMAGE_PRICES_USD",
    "LLM_CALL_USD",
    "STRESS_USD_JPY_RATE",
    "estimate_image_cost_jpy",
    "estimate_llm_cost_jpy",
    "estimate_wizard_cost_jpy",
    "image_price_usd",
]
