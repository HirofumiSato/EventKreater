"""画像生成 API の価格表と、生成前のコスト見積り。

外部 SDK も I/O も持たない純粋な計算だけを置く。予算を守る判定はここを通すので、
価格改定や為替の変動があったときは、この表と `tests/test_cost_budget.py` の
両方を見直す。テストが落ちれば、原価が目標（1 回あたり 10 円未満）を超えたことに
気づける。

価格は OpenAI の公表価格（USD / 1 枚）の概算。実装前に現行の料金ページで確認する。
`gpt-image-2.5` 系はトークン課金（画像出力 $30 / 1M トークン）で、1 枚あたりの額は
公表されていない。ここでは公式ガイドの代表サイズで公開されている換算値
（1024x1536 / low = 約 $0.0047）を、安全側に切り上げて持つ。
"""

from __future__ import annotations

#: 背景生成の標準構成。A4 縦（1080×1528）に切り抜いたときの欠落が最も小さい。
#: `gpt-image-1` は 2026-10-23 に API が停止したため、現行の `gpt-image-2.5` 系を使う。
DEFAULT_IMAGE_MODEL: str = "gpt-image-2.5-flare"
DEFAULT_IMAGE_QUALITY: str = "low"
DEFAULT_IMAGE_SIZE: str = "1024x1536"

#: `gpt-image-2.5` 系の 1 枚あたり USD（画質, サイズ）。トークン課金のため定価が
#: 無く、公式ガイドの代表サイズの換算値を安全側へ切り上げている。1024x1536 と
#: 1536x1024 は同額、1024x1024 は正方形で安い。`auto` は最上位まで振れるため
#: `max` と同じ額で見積もる（過小に出さない）。
_GPT_IMAGE_25_UNIT_USD: dict[tuple[str, str], float] = {
    ("low", "1024x1536"): 0.005,
    ("medium", "1024x1536"): 0.011,
    ("high", "1024x1536"): 0.042,
    ("xhigh", "1024x1536"): 0.074,
    ("max", "1024x1536"): 0.165,
    ("auto", "1024x1536"): 0.165,
    ("low", "1536x1024"): 0.005,
    ("medium", "1536x1024"): 0.011,
    ("high", "1536x1024"): 0.042,
    ("xhigh", "1536x1024"): 0.074,
    ("max", "1536x1024"): 0.165,
    ("auto", "1536x1024"): 0.165,
    ("low", "1024x1024"): 0.006,
    ("medium", "1024x1024"): 0.014,
    ("high", "1024x1024"): 0.053,
    ("xhigh", "1024x1024"): 0.094,
    ("max", "1024x1024"): 0.211,
    ("auto", "1024x1024"): 0.211,
}

#: 1 枚あたりの USD。表に無い組み合わせは安全側（そのモデルの最高額）へ倒す。
#: `gpt-image-1` は停止済み、`gpt-image-1.5` は 2026-12-01 停止予定。移行中の
#: 切り戻しが予算ガードで止まらないよう、両方の行は残してある。
IMAGE_PRICES_USD: dict[tuple[str, str, str], float] = {
    # 現行。sunburst は flare と同じトークン単価で、編集の精度だけが違う。
    **{
        (model, quality, size): price
        for model in ("gpt-image-2.5-flare", "gpt-image-2.5-sunburst")
        for (quality, size), price in _GPT_IMAGE_25_UNIT_USD.items()
    },
    # 非推奨（2026-12-01 停止）。切り戻し用に残す。
    ("gpt-image-1.5", "low", "1024x1536"): 0.013,
    ("gpt-image-1.5", "medium", "1024x1536"): 0.050,
    ("gpt-image-1.5", "high", "1024x1536"): 0.200,
    ("gpt-image-1.5", "low", "1536x1024"): 0.013,
    ("gpt-image-1.5", "medium", "1536x1024"): 0.050,
    ("gpt-image-1.5", "high", "1536x1024"): 0.200,
    ("gpt-image-1.5", "low", "1024x1024"): 0.009,
    ("gpt-image-1.5", "medium", "1024x1024"): 0.034,
    ("gpt-image-1.5", "high", "1024x1024"): 0.133,
    # 停止済み（2026-10-23）。記録として残す。
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
