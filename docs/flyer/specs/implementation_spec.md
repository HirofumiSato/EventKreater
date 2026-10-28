# 実装仕様書

## プロジェクト: 小規模店舗・イベント主催者向け AIチラシ自動生成Webアプリ
### 対象モジュール: 画像生成プロンプトエンジン & 決定論的文字合成レンダラー

## 1. 実行パイプラインアーキテクチャとデータフロー

本システムは、非決定的なビジュアル生成（AI層）と決定論的な情報描画（プログラム層）を完全に疎結合化し、以下の直列パイプラインで処理を実行する。

```text
[Frontend: ユーザー入力フォーム]
        │
        ▼ (POST /api/v1/generate)
[Backend Step 1: 入力データ検証] ────── (Pydantic: FlyerGenerationRequest)
        │
        ▼
[Backend Step 2: プロンプト合成エンジン] ─ (OpenAI gpt-4o-mini: Structured Outputs)
        │                                  ├─ 生成用英語プロンプト (copyspace確保)
        │                                  └─ スタイル付加パラメータ (HEX, 透過度)
        ▼
[Backend Step 3: 背景画像生成エンジン] ── (DALL-E 3 / Stable Diffusion API)
        │                                  └─ 未加工背景画像 (1080x1792 RGB / A4 へクロップ)
        ▼
[Backend Step 4: 決定論的文字合成エンジン]
        │  ├─ PIL/Pillow による商用フリーフォント読み込み・自動サイズ収束
        │  ├─ コントラスト保護数理モデル（相対輝度判定・自動遮光マスク）
        │  └─ テンプレート別幾何学グリッドへの座標配置
        ▼
[Frontend: プレビュー & 保存] ────────── (完成PNG/JPEGストリーム)
```

---

## 2. データ定義（Data Contracts）とプロンプト設計

### 2.1. 入力データ仕様（APIリクエストスキーマ）

Python (Pydantic v2) に準拠したリクエストモデルおよびバリデーション定義。

```python
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class TemplateId(str, Enum):
    STYLE_1_BAR_STYLISH = "style_1_bar_stylish"  # バー・ナイトイベント向け（ダーク・洗練）
    STYLE_2_WARM_EARTH = "style_2_warm_earth"  # サロン・ワークショップ向け（暖色・余白）
    STYLE_3_VIBRANT_POP = "style_3_vibrant_pop"  # マルシェ・フェス向け（高彩度・明快）


class RainPolicy(str, Enum):
    RAIN_OR_SHINE = "雨天決行"
    CANCEL_ON_RAIN = "雨天中止"
    POSTPONE_ON_RAIN = "雨天順延"
    INDOOR = "屋内開催"


class FlyerGenerationRequest(BaseModel):
    title: str = Field(
        ..., min_length=2, max_length=40, description="催しの名称"
    )
    event_date: str = Field(
        ...,
        min_length=4,
        max_length=30,
        description="開催日（例: 2026年11月15日(日)）",
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
    location: str = Field(
        ..., min_length=2, max_length=60, description="開催場所・店名"
    )
    rain_policy: RainPolicy = Field(
        default=RainPolicy.RAIN_OR_SHINE, description="雨天時の対応"
    )
    capacity: Optional[str] = Field(
        None, max_length=20, description="想定上限人数（例: 先着15名）"
    )
    semantic_theme: Optional[SemanticTheme] = Field(
        None,
        description="告知ページのテーマ。英語の design_direction として LLM に渡す",
    )
    template_id: TemplateId = Field(
        ..., description="選択されたデザインテンプレートID"
    )

    @field_validator("title")
    def sanitize_title(cls, v: str) -> str:
        return v.strip().replace("\n", " ")
```

---

### 2.2. LLMプロンプトエンジン（メタ解釈と構造化出力）

ユーザー入力をそのまま画像APIに渡すと、文字が描き込まれたり構図が破綻する。`gpt-4o-mini` の **Structured Outputs (JSON Schema)** を使用し、画像生成プロンプトとタイポグラフィ調整用メタデータを抽出する。

#### LLM出力スキーマ定義

```python
class LLMGenerationContext(BaseModel):
    image_prompt_en: str = Field(
        ...,
        description="DALL-E 3/SDXL向けの英語画像生成プロンプト。背景の被写体、光、質感、カメラアングルを指定",
    )
    negative_prompt_en: str = Field(
        ...,
        description="除外要素（text, letters, words, logos, human faces close-up 等）",
    )
    suggested_accent_color: str = Field(
        ...,
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="日付や重要情報の強調文字色（HEX）",
    )
    suggested_overlay_alpha: float = Field(
        ..., ge=0.2, le=0.7, description="背景画像に重ねる遮光レイヤーの不透明度"
    )
```

#### System Prompt設計

```markdown
# Role
You are an elite commercial art director specializing in event poster design.

# Goal
Analyze the user's event data and target aesthetic, then output a structured design direction:
1. An English prompt for generating a high-end background visual.
2. Safe negative prompts to strictly prevent image models from rendering text.
3. Color styling parameters compatible with readability.

# Critical Constraints on image_prompt_en
1. ABSOLUTE FORBIDDEN: Do NOT include any instructions that ask the image model to write text, letters, titles, dates, numbers, or calligraphy. 
2. COMPOSITION RULE: The image MUST have clear "negative space" (copyspace) specifically planned for text overlays:
   - For 'style_1_bar_stylish': The center and lower-third must be dark, atmospheric, out of focus, or uncluttered.
   - For 'style_2_warm_earth': Clean, soft, shallow depth of field, natural background with smooth textures.
   - For 'style_3_vibrant_pop': Dynamic composition with a central or bottom low-frequency area to hold text legible.
3. SUBJECT TRANSLATION: Do not just copy Japanese terms. Translate the emotional core of the event into visual elements (e.g., "A jazz session at a bar" -> "Cinematic close-up of a vintage brass saxophone resting on a polished mahogany counter, soft amber neon bokeh, atmospheric dust motes, dimly lit, 35mm photograph, moody, elegant").

# Output Format
Output MUST be strict JSON adhering to the provided schema.
```

---

## 3. 決定論的文字合成・幾何学レイアウトエンジン仕様

すべてのレンダリングは、**基準解像度 $1080 \times 1528\text{ px}$（A4 縦 210:297 / 画面・簡易印刷向け）** を絶対座標系として計算する。

### 3.1. 幾何学座標系とレイアウトグリッド

```text
(0,0) ────────────────────────────────────────────── (1080, 0)
 │                                                       │
 │  [Margin Top: 128px]                                  │
 │  ───────────────────────────────────────────────────  │
 │  [Zone A: Category / Catchphrase]  (H: 48px)          │  Y: 128 ~ 176
 │  ───────────────────────────────────────────────────  │
 │  [Zone B: Main Title Area]         (H: 336px, Max 3L) │  Y: 192 ~ 528
 │  ───────────────────────────────────────────────────  │
 │  [Zone C: Key Information Box]     (H: 208px)         │  Y: 576 ~ 784
 │    ├ Date & Time (Large Display)                      │
 │    └ Rain Policy Tag                                  │
 │  ───────────────────────────────────────────────────  │
 │  [Zone D: Detail Specifications]   (H: 384px)         │  Y: 828 ~ 1212
 │    ├ Location / Venue (Icon + Text)                   │
 │    ├ Admission / Price (Icon + Text)                  │
 │    └ Capacity / Reservation Info                      │
 │  ───────────────────────────────────────────────────  │
 │  [Zone E: Footer / Safe Area]      (H: 112px)         │  Y: 1290 ~ 1402
 │  ───────────────────────────────────────────────────  │
 │  [Margin Bottom: 126px]                               │
(0,1528) ────────────────────────────────────────── (1080, 1528)
```

---

### 3.2. テンプレート別スタイル・タイポグラフィ定義

| パラメータ | テンプレート1: スタイリッシュ（Bar向け） | テンプレート2: アットホーム（Salon向け） | テンプレート3: ポップ（Event向け） |
| :--- | :--- | :--- | :--- |
| **主要フォント** | Noto Serif JP (明朝体・高級感) | Noto Sans JP (Medium/Light・親しみ) | M PLUS 1p (Black/Bold・力強さ) |
| **文字揃え** | 完全中央揃え（Center-aligned） | 左揃え＋余白バランス（Left-aligned） | 左上タイトル＋グリッドブロック |
| **ベース文字色** | `#FFFFFF` (タイトル) / `#F3F4F6` | `#2D2A26` (チャコール) / `#4B463E` | `#FFFFFF` (タイトル) / `#111827` |
| **推奨アクセント色** | `#F59E0B` (Amber) / `#E11D48` (Rose) | `#059669` (Sage Green) / `#D97706` | `#FBBF24` (Yellow) / `#3B82F6` |
| **背景保護レイヤー** | 全面ダークグラデーション (Alpha: 0.55) | 下部カード型ソリッド角丸矩形 (白/90%不透明) | ネオン境界線＋半透明黒角丸ボックス |

---

### 3.3. 動的文字スケーリング・折り返しアルゴリズム

タイトルが指定矩形領域（幅 $W_{\max} = 920\text{ px}$, 高さ $H_{\max} = 336\text{ px}$）をはみ出さないよう、**二分探索（Binary Search）によるフォントサイズ自動収束アルゴリズム**を適用する。

$$S \in [S_{\min}, S_{\max}] \quad (S_{\min}=48\text{ px}, S_{\max}=96\text{ px})$$

```python
from PIL import ImageDraw, ImageFont


def calculate_optimal_font_and_lines(
    text: str,
    font_path: str,
    draw: ImageDraw.ImageDraw,
    max_w: int = 920,
    max_h: int = 336,
    min_size: int = 44,
    max_size: int = 92,
    line_spacing_ratio: float = 1.3,
) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """指定領域に厳密に収まるフォントサイズと改行行リストを二分探索で算出する。"""
    best_font = None
    best_lines = []

    low = min_size
    high = max_size

    while low <= high:
        mid_size = (low + high) // 2
        font = ImageFont.truetype(font_path, mid_size)

        # 文字幅ベースの動的行分割
        lines = []
        current_line = ""
        for char in text:
            test_line = current_line + char
            bbox = draw.textbbox((0, 0), test_line, font=font)
            line_w = bbox[2] - bbox[0]
            if line_w <= max_w:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line)
                current_line = char
        if current_line:
            lines.append(current_line)

        # 最大行数制限（タイトルは最大3行まで）
        if len(lines) > 3:
            high = mid_size - 2
            continue

        # 描画総高の計算
        sample_bbox = draw.textbbox((0, 0), "あA", font=font)
        single_line_h = sample_bbox[3] - sample_bbox[1]
        total_h = int(
            single_line_h * len(lines)
            + (len(lines) - 1) * single_line_h * (line_spacing_ratio - 1.0)
        )

        if total_h <= max_h:
            best_font = font
            best_lines = lines
            low = mid_size + 2  # さらに大きなサイズを探索
        else:
            high = mid_size - 2  # 領域超過のため縮小

    if best_font is None:
        best_font = ImageFont.truetype(font_path, min_size)
        best_lines = [text[:15], text[15:30]]

    return best_font, best_lines
```

---

### 3.4. コントラスト保護数理モデル（WCAG 2.1準拠）

背景画像が動的に生成されるため、文字可読性を保証するガードレールを数理的に組み込む。

#### 1. 相対輝度（Relative Luminance）の計算式
ピクセルの sRGB 値 $(R, G, B \in [0, 1])$ から相対輝度 $L$ を算出：

$$R_s = \begin{cases} \frac{R}{12.92} & (R \le 0.04045) \\ \left(\frac{R + 0.055}{1.055}\right)^{2.4} & (R > 0.04045) \end{cases}$$

$$L = 0.2126 R_s + 0.7152 G_s + 0.0722 B_s$$

#### 2. コントラスト比（Contrast Ratio） $C$
文字色の輝度 $L_1$ と背景領域の平均輝度 $L_2$（ただし $L_1 > L_2$）：

$$C = \frac{L_1 + 0.05}{L_2 + 0.05}$$

*   **判定基準:** $C \ge 4.5$（WCAG 2.1 AA規格・通常文字）を合格基準とする。
*   **動的補正ロジック:** 
    文字描画矩形直下の画像領域をサンプリングし、$C < 4.5$ の場合、文字直下に**自動的にブラー付きドロップシャドウ（Gaussian Radius: 12px）**、または**局所半透明バックドロップレイヤー（Alpha値加算）**を強制適用してコントラストを担保する。

---

## 4. 自己反証とトレードオフ分析

本実装仕様が直面する3つの工学的批判と回避策。

### 反証1: 静的座標モデルにおける視覚的重心の破綻
* **批判:** タイトルが極端に短い（例:「JAZZ」4文字）場合、フォントサイズ上限（92px）に達しても縦方向の余白が余りすぎ、中央に不自然な空白が生じる。
* **判定・対策:** 文字数が10文字未満の場合、字間（Letter Spacing）を動的に $+15\text{ px}$ 拡大し、サブキャッチコピー（Zone A）との垂直パディングを自動再計算して空間を埋める。

### 反証2: 高周波テクスチャ（ノイズ）による文字可読性破壊
* **批判:** 相対輝度の平均値が計算上クリアされていても、背景に細かな木の葉や照明のきらめき等の高周波ノイズが存在すると、人間の視覚認知上エッジが干渉して文字が読めなくなる。
* **判定・対策:** 文字描画領域背面のラプラシアン分散（エッジ強度）を計測し、閾値を超える場合は、文字の周囲に幅2pxのアウトライン（縁取り）または背景側の局所ガウシアンブラーを自動適用する。

### 反証3: サーバーサイドPillow描画とフロントエンド描画の差異
* **批判:** サーバー（Python Pillow）とフロントエンド（Canvas/CSS）でフォント描画エンジンが異なると、プレビューとダウンロード画像で改行位置や文字間にズレが生じる。
* **判定・対策:** フロントエンドでのクライアント側再計算プレビューを完全に排除する。サーバーがPillowで描画した確定ビットマップ画像ストリームのみを画面にロードし、1ピクセルの差異も生じさせない。

---

## 5. 【参考】難易度順の参照フレームワーク

本仕様の理解と将来的な機能拡張（ローカルLLMへの切り替え、デザイン自動最適化）に向けた3段階の学習ソース。

* **Step 1（基礎原理）: Robert Bringhurst『The Elements of Typographic Style』**
  * *視座:* 「文字を置く」という作業を、垂直リズム、スケール比、余白の調和といった数学的プロポーションとして把握し、破綻のないレイアウト基準を確立する。
* **Step 2（実装・実践）: Robin Williams『The Non-Designer's Design Book』**
  * *視座:* デザインの4大原則（近接・整列・反復・コントラスト）をプログラムの座標決定ルールへ写像し、自動化するための実践判断基準を確立する。
* **Step 3（最先端の限界）: Google Material Design 3 Spec（Dynamic Color & Typography Algorithms）**
  * *視座:* 背景画像から動的にカラーパレットを抽出し、色覚多様性やコントラスト規格（APCA / WCAG 3.0）に適合させながらタイポグラフィを適応させる最先端アルゴリズムを学ぶ。