"""業務エンティティ。実装仕様書 2.1 / 2.2 のデータ契約。"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TemplateId(str, Enum):
    """選択されたデザインテンプレート ID。"""

    STYLE_1_BAR_STYLISH = "style_1_bar_stylish"
    STYLE_2_WARM_EARTH = "style_2_warm_earth"
    STYLE_3_VIBRANT_POP = "style_3_vibrant_pop"


class RainPolicy(str, Enum):
    """雨天時の対応。"""

    RAIN_OR_SHINE = "雨天決行"
    CANCEL_ON_RAIN = "雨天中止"
    POSTPONE_ON_RAIN = "雨天順延"
    INDOOR = "屋内開催"


class TextLayout(str, Enum):
    """文字ブロックの配置プリセット。座標は adapters/renderer/layouts.py が持つ。"""

    CLASSIC = "classic"
    TOP_STACK = "top_stack"
    CENTER_STACK = "center_stack"
    BOTTOM_STACK = "bottom_stack"


class CandidateKind(str, Enum):
    """ウィザードのどの段階の候補か。"""

    TYPE = "type"
    BACKGROUND = "background"
    LAYOUT = "layout"
    PALETTE = "palette"
    TITLE_COLOR = "title_color"


class SemanticTheme(str, Enum):
    """告知ページで選んだセマンティックテーマ。

    ID は `src/lib/semantic-themes.ts` と揃える。背景の雰囲気をページと揃えるために、
    LLM へ英語の方向付け（`design_direction`）として渡す。未指定（None）は標準。
    """

    MODERN_SLATE = "modern-slate"
    ENTERPRISE_CLEAN = "enterprise-clean"
    PARCHMENT = "parchment"
    NEO_BRUTALISM = "neo-brutalism"
    NEON = "neon"
    WASHI = "washi"
    SAGE = "sage"
    CANDY = "candy"
    DUSK = "dusk"

    @property
    def design_direction(self) -> str:
        """画像生成へ渡す英語の方向付け。"""
        return _THEME_DIRECTIONS[self]


_THEME_DIRECTIONS: dict[SemanticTheme, str] = {
    SemanticTheme.MODERN_SLATE: (
        "dark slate ground, white high-contrast type, cinematic low-key photography, "
        "quiet and composed atmosphere"
    ),
    SemanticTheme.ENTERPRISE_CLEAN: (
        "bright neutral ground, thin restrained borders, clean daylight photography, "
        "calm and trustworthy tone"
    ),
    SemanticTheme.PARCHMENT: (
        "warm off-white paper texture, serif editorial mood, soft natural light, "
        "vintage print feel"
    ),
    SemanticTheme.NEO_BRUTALISM: (
        "heavy black outlines, hard offset shadows, bold saturated flat color, "
        "handmade poster energy"
    ),
    SemanticTheme.NEON: (
        "black ground, cyan neon glow, night club energy, wet reflections, high contrast"
    ),
    SemanticTheme.WASHI: (
        "washi paper fiber ground, indigo accent, serif mincho headings with wide tracking, "
        "quiet seasonal mood, soft indirect light"
    ),
    SemanticTheme.SAGE: (
        "pale sage ground, shadowless flat surfaces, generous white space, "
        "short measure and calm breathing, soft daylight"
    ),
    SemanticTheme.CANDY: (
        "peach cream ground, round soft shapes, rose pink accent, playful bright light, "
        "friendly and sweet atmosphere"
    ),
    SemanticTheme.DUSK: (
        "deep warm brown ground, orange sunset rim light, dusk outdoor gathering, "
        "glowing warm highlights, relaxed evening mood"
    ),
}


class FlyerStatus(str, Enum):
    """生成パイプラインの完了状態。"""

    SUCCESS = "success"
    FALLBACK_USED = "fallback_used"


def sanitize_user_text(value: str) -> str:
    """前後空白を除き、改行を空白へ置換する。"""
    return value.strip().replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


class FlyerGenerationRequest(BaseModel):
    """チラシ生成リクエスト。文字数制限とタイトルのサニタイズを持つ。"""

    model_config = ConfigDict(extra="ignore")

    title: str = Field(..., min_length=2, max_length=40, description="催しの名称")
    event_date: str = Field(
        ...,
        min_length=4,
        max_length=30,
        description="開催日（例: 2026年11月15日(日)）。ISO の 2026-11-15 も描画側で日本語に直す",
    )
    event_time: str = Field(
        ...,
        min_length=4,
        max_length=30,
        description="開催時間（例: 19:00〜22:00 (開場 18:30)）",
    )
    price: str = Field(
        ...,
        min_length=1,
        max_length=30,
        description="費用（例: 3,000円 (1ドリンク付)）",
    )
    location: str = Field(..., min_length=2, max_length=60, description="開催場所・店名")
    rain_policy: RainPolicy = Field(
        default=RainPolicy.RAIN_OR_SHINE,
        description="雨天時の対応",
    )
    capacity: str | None = Field(
        None,
        max_length=20,
        description="想定上限人数（例: 先着15名）",
    )
    semantic_theme: SemanticTheme | None = Field(
        default=None,
        description="告知ページで選んだテーマ。背景の雰囲気をページと揃える。未指定は標準",
    )
    target_generation: str | None = Field(
        default=None,
        max_length=50,
        description="想定する参加者の世代（例: 20代から40代）。背景の人物像と光の当て方に使う",
    )
    template_id: TemplateId = Field(..., description="選択されたデザインテンプレートID")
    layout_id: TextLayout = Field(
        default=TextLayout.CLASSIC,
        description="文字ブロックの配置プリセット",
    )
    title_color: str | None = Field(
        default=None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="タイトルの文字色。未指定なら背景の色に合わせて自動で決める",
    )

    @field_validator("title", "event_date", "event_time", "price", "location", mode="before")
    @classmethod
    def sanitize_required_text(cls, value: object) -> object:
        if isinstance(value, str):
            return sanitize_user_text(value)
        return value

    @field_validator("capacity", mode="before")
    @classmethod
    def sanitize_capacity(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            cleaned = sanitize_user_text(value)
            return cleaned or None
        return value


class LLMGenerationContext(BaseModel):
    """画像生成プロンプトと可読性向けスタイルパラメータ。"""

    model_config = ConfigDict(extra="forbid")

    image_prompt_en: str = Field(
        ...,
        min_length=1,
        description="DALL-E 3/SDXL向けの英語画像生成プロンプト。背景の被写体、光、質感、カメラアングルを指定",
    )
    negative_prompt_en: str = Field(
        ...,
        min_length=1,
        description="除外要素（text, letters, words, logos, human faces close-up 等）",
    )
    suggested_accent_color: str = Field(
        ...,
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="日付や重要情報の強調文字色（HEX）",
    )
    suggested_overlay_alpha: float = Field(
        ...,
        ge=0.2,
        le=0.7,
        description="背景画像に重ねる遮光レイヤーの不透明度",
    )


class RenderMetadata(BaseModel):
    """決定論的レンダラーが採用した幾何・コントラスト上の決定。"""

    model_config = ConfigDict(extra="forbid")

    canvas_width: int = Field(default=1080, ge=1)
    canvas_height: int = Field(default=1528, ge=1)
    template_id: TemplateId
    layout_id: TextLayout = TextLayout.CLASSIC
    accent_color: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    overlay_alpha: float = Field(..., ge=0.0, le=1.0)
    title_font_size: int = Field(..., ge=1)
    title_line_count: int = Field(..., ge=1, le=3)
    title_block_width: int = Field(..., ge=0)
    title_block_height: int = Field(..., ge=0)
    #: 最終行を右端へぶら下げたか。意味の区切りで短い結びが残ったときだけ立つ。
    title_hanging: bool = Field(
        default=False,
        description="最終行をブロック右端へ寄せたか",
    )
    #: 実際に描いたタイトルの色。選んだ色と違うことがある（背景に合わせて直すため）。
    title_color: str = Field(
        default="#000000",
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="描画に使ったタイトルの文字色",
    )
    #: 選ばれた色から変えたか。白を選んで地を暗くした場合などに立つ。
    title_color_adjusted: bool = Field(
        default=False,
        description="背景に合わせてタイトル色を選び直したか",
    )
    contrast_ratio: float = Field(..., ge=1.0)
    backdrop_applied: bool
    outline_applied: bool
    letter_spacing_px: int = Field(default=0, ge=0)


class FlyerAsset(BaseModel):
    """一時保存された完成チラシ。"""

    model_config = ConfigDict(extra="forbid")

    flyer_id: str = Field(..., min_length=1)
    status: FlyerStatus
    image_url: str = Field(..., min_length=1)
    content_type: Literal["image/jpeg", "image/png"] = "image/jpeg"
    created_at: datetime
    render_metadata: RenderMetadata | None = None


class FlyerGenerationResponse(BaseModel):
    """API がクライアントへ返す生成結果。"""

    model_config = ConfigDict(extra="forbid")

    status: FlyerStatus
    generation_id: str = Field(..., min_length=1)
    image_url: str = Field(..., min_length=1)


class FlyerGenerateCommand(FlyerGenerationRequest):
    """確定リクエスト。candidate_id があれば選択済みの画像を再利用する。"""

    candidate_id: str | None = Field(
        default=None,
        description="ウィザードで選んだ候補の UUID",
    )


class CandidateProposalCommand(FlyerGenerationRequest):
    """候補提案リクエスト。count はステップ 2 のタイル枚数。"""

    count: int = Field(
        default=1,
        ge=1,
        le=16,
        description="候補背景の枚数。画面は 1 枚ずつ作り直す",
    )


class CandidateItem(BaseModel):
    """ウィザードのタイル 1 枚。"""

    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(..., min_length=1)
    kind: CandidateKind
    label: str = Field(..., min_length=1)
    description: str = ""
    image_url: str = Field(..., min_length=1)
    template_id: TemplateId
    layout_id: TextLayout
    palette_id: str
    accent_color: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    overlay_alpha: float = Field(..., ge=0.0, le=1.0)
    #: タイトルの文字色。`None` は「自動」。
    title_color: str | None = Field(
        default=None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="タイトルの文字色。None は背景に合わせる",
    )
    #: 供給元。`ai` のときだけ課金が起きる。
    source: str = Field(default="placeholder")
    #: AI 背景の残り枚数。背景候補のステップだけ入る。
    ai_remaining: int | None = Field(default=None)
    #: 前段で選んだテーマに合う 1 枚。ステップ 1 だけ立つ。
    recommended: bool = Field(default=False)


class CandidateList(BaseModel):
    """1 ステップ分のタイル一覧。"""

    model_config = ConfigDict(extra="forbid")

    candidates: list[CandidateItem]


class CandidateMeta(BaseModel):
    """候補画像と一緒に保存する、子候補を再描画するための材料。"""

    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(..., min_length=1)
    kind: CandidateKind
    template_id: TemplateId
    layout_id: TextLayout
    palette_id: str = Field(..., min_length=1)
    accent_color: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    overlay_alpha: float = Field(..., ge=0.0, le=1.0)
    #: タイトル色ステップで選ばれた ID（auto / ink / white / accent）。
    title_color_id: str | None = Field(
        default=None,
        max_length=32,
        description="タイトル色の選択肢 ID。古い候補では None。",
    )
    parent_id: str | None = None
    label: str = Field(..., min_length=1)
    description: str = ""
    source: str = "placeholder"
    owner_token_hash: str | None = Field(
        default=None,
        description="BFF が発行した端末トークンの SHA-256。候補を参照できる相手を絞る。",
    )
    request: FlyerGenerationRequest
    context: LLMGenerationContext
