"""環境変数。API キーが無いときはモックアダプターを使う。"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.domain.pricing import (
    DEFAULT_IMAGE_MODEL,
    DEFAULT_IMAGE_QUALITY,
    DEFAULT_IMAGE_SIZE,
    DEFAULT_MAX_COST_JPY_PER_REQUEST,
    STRESS_USD_JPY_RATE,
)

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """実行時設定。詳細設計の TTL は 3600 秒。"""

    model_config = SettingsConfigDict(extra="ignore")

    openai_api_key: str | None = Field(default=None)
    openai_text_model: str = "gpt-4o-mini"
    #: 背景画像のモデル。A4 縦への欠落が小さい gpt-image-1 を既定にする。
    openai_image_model: str = DEFAULT_IMAGE_MODEL
    #: 画質。gpt-image-1 は low / medium / high、dall-e-3 は standard / hd。
    image_quality: str = DEFAULT_IMAGE_QUALITY
    #: 要求する画像サイズ。モデルに無い値はクライアントが寄せる。
    image_size: str = DEFAULT_IMAGE_SIZE
    image_generation_timeout_seconds: float = 25.0
    image_generation_max_attempts: int = 2
    llm_timeout_seconds: float = 20.0
    storage_dir: Path = _PROJECT_ROOT / "src" / "static" / "tmp"
    fallback_dir: Path = _PROJECT_ROOT / "src" / "static" / "default_backgrounds"
    candidate_dir: Path = _PROJECT_ROOT / "src" / "static" / "candidates"
    ttl_seconds: int = 3600
    cleanup_interval_seconds: int = 600
    disk_free_ratio_threshold: float = 0.10
    #: AI の背景候補を出すか。None は API キーの有無に従う（True/False で固定）。
    ai_candidates_enabled: bool | None = None
    #: 1 時間・1 端末あたりに AI で作る背景の枚数。初回 1 ＋ 作り直し 2。
    ai_candidate_max_per_hour: int = 3
    #: 見積りに使う為替。円安側に置き、原価を過小に見積もらない。
    usd_jpy_rate: float = STRESS_USD_JPY_RATE
    #: 1 回の生成で守る原価の上限（円）。10 円未満に余裕を残す。
    max_cost_jpy_per_request: float = DEFAULT_MAX_COST_JPY_PER_REQUEST
    #: ウィザード候補の寿命。開きっぱなしの下書きでも選び直せるよう 1 時間。
    candidate_ttl_seconds: int = 3600
    #: アップロード画像の上限。BFF と同じ 8MB。
    upload_max_bytes: int = 8 * 1024 * 1024
    #: デコード爆弾を避けるための画素数上限。1080×1528 の約 24 倍。
    upload_max_pixels: int = 40_000_000

    @field_validator("openai_api_key", mode="before")
    @classmethod
    def blank_api_key_is_absent(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("ai_candidates_enabled", mode="before")
    @classmethod
    def blank_flag_is_absent(cls, value: object) -> object:
        """空文字は「未設定」と同じ。キーの有無に従う。"""
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def ai_candidates_active(self) -> bool:
        """AI の背景候補を使うか。未設定なら API キーの有無に従う。"""
        if self.ai_candidates_enabled is None:
            return bool(self.openai_api_key)
        return self.ai_candidates_enabled
