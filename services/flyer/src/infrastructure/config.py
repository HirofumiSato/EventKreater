"""環境変数。API キーが無いときはモックアダプターを使う。"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """実行時設定。詳細設計の TTL は 3600 秒。"""

    model_config = SettingsConfigDict(extra="ignore")

    openai_api_key: str | None = Field(default=None)
    openai_text_model: str = "gpt-4o-mini"
    openai_image_model: str = "dall-e-3"
    image_generation_timeout_seconds: float = 25.0
    image_generation_max_attempts: int = 2
    llm_timeout_seconds: float = 20.0
    storage_dir: Path = _PROJECT_ROOT / "src" / "static" / "tmp"
    fallback_dir: Path = _PROJECT_ROOT / "src" / "static" / "default_backgrounds"
    candidate_dir: Path = _PROJECT_ROOT / "src" / "static" / "candidates"
    ttl_seconds: int = 3600
    cleanup_interval_seconds: int = 600
    disk_free_ratio_threshold: float = 0.10
    #: ステップ 2 で並べる背景タイルの枚数。
    candidate_count: int = 8
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
