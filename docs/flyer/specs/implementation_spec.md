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
    # ID は保存済みチラシとの互換のため変えない。表示名だけが「紙面の性格」を指す。
    STYLE_1_BAR_STYLISH = "style_1_bar_stylish"  # 静けさ（中央揃え・明朝・紙のまま）
    STYLE_2_WARM_EARTH = "style_2_warm_earth"  # やわらかさ（左揃え・ゴシック・沈めた帯）
    STYLE_3_VIBRANT_POP = "style_3_vibrant_pop"  # にぎやかさ（左揃え・極太・墨の面）


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
    target_generation: Optional[str] = Field(
        None,
        max_length=50,
        description="想定する参加者の世代。人物像と光の当て方に使う",
    )
    template_id: TemplateId = Field(
        ..., description="選んだ紙面の性格の ID。書体・揃え・保護レイヤーの形に使う"
    )
    layout_id: TextLayout = Field(
        TextLayout.CLASSIC,
        description="文字ブロックの配置プリセット。余白の指示に使う",
    )
    title_color: Optional[str] = Field(
        None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
        description="タイトルの文字色。未指定は背景の明るさから自動で決める",
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
You are an elite commercial art director specializing in Japanese event flyer design.

# Goal
Analyze the user's event data and target aesthetic, then output a structured design direction:
1. An English prompt for generating a high-end background visual.
2. Safe negative prompts that keep image models from rendering any lettering, including Japanese characters and kanji.
3. Color styling parameters compatible with readability.

# Deliverable
One text-free background for a Japanese event flyer that is delivered to prospective participants by URL.
Framing: draw a 2:3 portrait image. It is then center-cropped to A4 portrait (1080x1528), so the top and bottom edges are lost. Keep the subject and every focal point inside the central 85% of the frame.
Every Japanese character is drawn later by a deterministic renderer; you design only the ground it sits on.
This is a flyer backdrop, not a poster: no typography, no layout mockups.

# How to read the event data
- title: the event's identity. Translate its emotional core into one concrete subject.
- event_date, event_time: infer season and time of day (19:00 -> night, 11月 -> autumn).
- location: infer venue type (bar, studio, hall, park) and indoor/outdoor cues.
- rain_policy: 屋内開催 -> indoor only; 雨天決行 -> outdoor is allowed.
- price, capacity: infer scale and tier (intimate vs large, premium vs casual). Never render them.
- target_generation: match the audience's generation in styling, wardrobe, and energy.
- semantic_theme and design_direction: control palette and mood.
- template_id: apply the composition rule for that template.
- layout_id: keep the band where the text sits calm and low-frequency.

# Critical Constraints on image_prompt_en
1. ABSOLUTE FORBIDDEN: Do NOT include any instructions that ask the image model to write text, letters, titles, dates, numbers, or calligraphy. 
2. COMPOSITION RULE: The image MUST have clear "negative space" (copyspace) specifically planned for text overlays:
   - For 'style_1_bar_stylish': The center and lower-third must be dark, atmospheric, out of focus, or uncluttered.
   - For 'style_2_warm_earth': Clean, soft, shallow depth of field, natural background with smooth textures.
   - For 'style_3_vibrant_pop': Dynamic composition with a central or bottom low-frequency area to hold text legible.
3. SUBJECT TRANSLATION: Do not just copy Japanese terms. Translate the emotional core of the event into visual elements (e.g., "A jazz session at a bar" -> "Cinematic close-up of a vintage brass saxophone resting on a polished mahogany counter, soft amber neon bokeh, atmospheric dust motes, dimly lit, 35mm photograph, moody, elegant").
4. DO NOT use the words poster, flyer, banner, headline, typography, logo, or menu in image_prompt_en; they bias the image model toward drawing type.
5. Do not place the subject or a strong focal point within 8% of the top or bottom edge; that area is cropped away.

# Output Format
Output MUST be strict JSON adhering to the provided schema.
```

ユーザーメッセージに載せる項目は `src/domain/prompt_payload.py` の
`_CONTEXT_KEYS` で決める。`count` のような操作パラメータや未入力の項目は渡さない。
`composition_hint`（配置の余白指示と、A4 への切り抜きで上下が落ちる前提）も同じ
JSON に足し、LLM が構図を先に考えられるようにする。画面項目との対応表は
:doc:`context_contract` にある。

---

## 3. 決定論的文字合成・幾何学レイアウトエンジン仕様

すべてのレンダリングは、**基準解像度 $1080 \times 1528\text{ px}$（A4 縦 210:297 / 画面・簡易印刷向け）** を絶対座標系として計算する。

### 3.1. 幾何学座標系とレイアウトグリッド

```text
(0,0) ────────────────────────────────────────────── (1080, 0)
 │  [Margin Top: 128px]                                  │
 │  [eyebrow: 日付]        22px / 字間 +4 / 差し色        │  H: 24
 │  [meta: 時刻]           34px / 墨の補助色              │  H: 40
 │  [title: 催し名]        42〜163px / 行間 1.18          │  最大 3 行
 │  [rule: 差し色の罫線]   96 / 888 / 240px               │  H: 2〜6
 │                                                       │
 │            （ここは写真の主役が残る）                  │
 │                                                       │
 │  [facts: 会場・参加費・定員]  ラベル 22 / 値 27         │  1px の罫線で区切る
 │  [note: 雨天の扱い]     17px / 墨の補助色              │  H: 24
 │  [Margin Bottom: 128px]                               │
(0,1528) ────────────────────────────────────────── (1080, 1528)
```

日付と時刻は同じ群に置く。片方を上端、片方を下端へ離すと、いつ開く催しなのかを
目が 2 往復して読むことになる。時刻は日付より大きく、タイトルより小さい。

左右の余白は 96 px、本文幅は 888 px。縦位置はすべて 8 px の倍数に載せる。
文字サイズは比 1.25 の 11 段（17 / 22 / 27 / 34 / 42 / 53 / 66 / 83 / 104 / 130 / 163）だけで、
中間の値は作らない。数値は `src/adapters/renderer/design.py` が 1 箇所で持つ。

---

### 3.2. 紙面の性格ごとのスタイル・タイポグラフィ定義

3 つは同じ軸（静けさ）の 3 点で、色は持たない。地の明度と文字色は前段で選んだ
セマンティックテーマ（`src/styles/themes.css` の `--st-*`）が決め、ここは
書体・揃え・面の濃さだけを決める。3 種は同じ格子・同じスロット順で、変えるのは
下の 3 列だけである。面（paper / band / full ink）は写真の上に敷く
半透明の矩形で、文字はその上に載る。

| パラメータ | 静けさ | やわらかさ | にぎやかさ |
| :--- | :--- | :--- | :--- |
| **主要フォント** | 明朝体・セリフ体（Noto Serif JP 等） | ゴシック体 Medium（Noto Sans JP 等） | 極太ゴシック体（M PLUS 1p Black 等） |
| **文字揃え** | 完全中央揃え | 左揃え | 左揃え |
| **積みの基準** | `split`（上に題・下に明細） | `top`（上寄せ） | `center`（中央寄せ） |
| **面** | 紙のまま（`veil` は紙色 0.55） | 紙を 7% 沈めた帯（明細の背後） | 墨の面（明細から下端まで・`plate_alpha` 0.86） |
| **罫線** | 96 px / 2 px / 差し色 | 全幅 / 1 px / 墨の補助色 | 240 px / 6 px / 差し色 |
| **明細** | 中央に 3 行 | ラベル左・値右の 2 列 | 値 34 px を主役に |
| **タイトル上限** | 104 px | 83 px | 163 px |

`veil` の向きは文字の明度で決める。文字が地より明るければ墨の面の色、暗ければ
紙色の薄い幕を重ねる。暗い写真に白い題名を載せるときに、紙色を塗って文字ごと
沈める事故を防ぐ。幕の濃さは `veil_alpha()` が必要な最小の不透明度を返す。

eyebrow（日付）は種目名を焼かず、日付だけを置く。利用者が入力していない
「ナイトイベント」等を紙面へ入れないためである。時刻（meta）はそのすぐ下に置き、
日付と 1 つの群にする。

差し色は既定では 2 箇所（eyebrow と rule）だけに使い、大きな文字には使わない。
ただしステップ 5 で題名に差し色を選ぶことはできる。その場合も必ず `safe_accent()`
を通した値（紙に対して 4.5:1）を使い、生の黄（`#FFE600`）や藍（`#4F46E5`）を
そのまま置かない。地が写真のときは、描画時に `resolve_title_color()` が
ベール後の地を見て濃さを寄せる。

---

### 3.3. 目盛りからの文字選択・折り返しアルゴリズム

タイトルの文字サイズは「枠に入る最大値」を探さない。`TITLE_STEPS`
（163 / 130 / 104 / 83 / 66 / 53 / 42）を大きい順に試し、幅（888 px）と高さ
（480 px、最大 3 行）に収まった最初の段を採る（`fit_to_scale()`）。途中の値は作らない。

折り返す位置は文字幅だけでは決めない。幅に収めるだけなら 1 文字ずつ詰めれば足りるが、
「焚火とシチューの / 夕べ」を「焚火とシチューの夕 / べ」にすると、最終行に 1 文字だけが
残って読みにくい。そこで同じ段の中で次の順に案を比べる。

1. **1 行に収まるなら改行しない。** まず 1 行の案を試し、収まればそこで確定する。
2. **収まらないときは、意味の区切りで分ける。** `src/domain/title_composition.py` の
   `title_splits` が、助詞の直後・句読点の直後・末尾語の直前・文字種の変わり目・
   利用者が入れた空白を加点し、読みやすい切り方を評価の高い順に返す。
3. **同じ段で複数の案が収まるときは、行数が少ない案を採る。** 行数が同じなら
   評価の高い順（`title_splits` の並び）を採る。段を下げてまで行数を減らさない。
4. 意味の区切りで分けられないときは、文字幅ベースの折り返しへ落とす。

行頭・行末の制約は候補を作る時点で外す。1 文字だけの行、小書き仮名（ゃ・ュ・ッ など）
から始まる行、句読点や閉じ括弧から始まる行、開き括弧で終わる行は候補にしない。

#### ぶら下げ（hanging）

最終行が 2〜5 文字で、最長行の幅の 70% 未満のとき、最終行だけを本文ブロックの右端へ
揃える。これが「焚火とシチューの／夕べ」の右下配置にあたる。揃えるのは右端だけで、
行の高さ・行間・フォントサイズは他の行と変えない。1 行のタイトルではぶら下げない。
左寄せの変奏でだけ使い、`RenderMetadata.title_hanging` に真偽を残す。

```python
def fit_to_scale(
    text: str,
    font_path: str,
    draw: ImageDraw.ImageDraw,
    *,
    steps: Sequence[int] = TITLE_STEPS,
    max_width: int = TITLE_MAX_WIDTH,
    max_height: int = TITLE_MAX_HEIGHT,
    max_lines: int = TITLE_MAX_LINES,
    allow_hanging: bool = False,
) -> TitleFit:
    """目盛りの大きい段から順に試し、最初に収まった組み方を返す。"""
    normalized = " ".join(text.split())
    spacing = SHORT_TITLE_TRACKING if len(normalized) <= SHORT_TITLE_MAX_CHARS else 0
    candidates = _candidates(normalized, max_lines)
    for size in steps:
        ...
```

字間は 1 行のときだけ開く（10 文字以下で 6 px、ラベルは 4 px）。2 行以上では 0 にする。
字間で幅を食うと、意味の区切りを入れる余地がなくなるためである。

`src/adapters/renderer/poster.py` の `build_poster_plan()` は、この `TitleFit` と
`StackSpec`（積みの基準位置）からスロットの文字・大きさ・y・色を決める純関数である。
画像もフォントも触らないため、目盛りとリズムは Pillow を通さずに検証できる。

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
*   **タイトル色の決定:** 題名は最も大きい文字で、写真の主役の上に載りやすい。紙色に
    対して補正した墨をそのまま置くと、暗い写真の上で黒く沈む。そこで見出しの群の
    平均色を測り、`resolve_title_color()` で次の順に決める。
    1. ステップ 5 で色が選ばれていれば、その色をそのまま使う（勝手に変えない）。
    2. 未指定（自動）なら、墨が 4.5 を満たせば墨、満たさなければ白。
    3. どちらも満たない中間の地では墨を返し、ベールで地を持ち上げる。
*   **ベールの向き:** 文字が紙より明るければ墨の面の色（`surface_for(paper, "ink")`）、
    暗ければ紙を重ねる。白い題名の上に紙色を塗ると、選んだ色が読めなくなるため、
    見出しの群だけは「地を測る → 色を決める → ベールを敷く → 濃さを寄せる」の順で描く。
*   **動的補正ロジック:**
    文字の群（見出し / 詳細）ごとに、その矩形直下の平均色を取る。$C < 4.5$ のとき、
    文字色と同じ側の面の色を薄く重ねる（`veil_alpha()`）。不透明度は 0.2 / 0.3 / … / 1.0 を
    順に試し、4.5 を満たした最初の値を使う。黒や白のスクリムを置かず、角丸の板も使わない。
    敷き切っても届かないとき（文字と敷く色が近いとき）は敷かない。届かないベールを
    1.0 で重ねると、地を塗り潰したうえで読めないままになる。
    墨の面（にぎやかさ）は面の色を、それ以外は紙の色を重ねる。
*   **選ばれた色が読めないとき:** ベールで救えないほど地に近い色（例: 白い紙に `#EEEEEE`）は、
    `ensure_contrast()` でベール後の地に対して濃さを寄せる。寄せたかどうかは
    `RenderMetadata.title_color_adjusted` に残す。
*   **差し色の補正:** 差し色は文字に使う前に `safe_accent()` を通す。紙に対して 4.5 を
    下回るときは、黒（地が明るい場合）または白（地が暗い場合）へ 5% ずつ寄せ、
    満たした時点で止める。色相は残し、明度だけを動かす。

---

## 4. 自己反証とトレードオフ分析

本実装仕様が直面する3つの工学的批判と回避策。

### 反証1: 静的座標モデルにおける視覚的重心の破綻
* **批判:** タイトルが極端に短い（例:「JAZZ」4文字）場合、目盛りの上限（163px）に達しても縦方向の余白が余りすぎ、中央に不自然な空白が生じる。
* **判定・対策:** 10 文字以下のタイトルは字間を +6px 開き、選ばれた段の中で行幅を広げる。段を飛ばして大きくしない。余白は写真の主役が使う領域であり、空隙ではなく余白として扱う。

### 反証2: 高周波テクスチャ（ノイズ）による文字可読性破壊
* **批判:** 相対輝度の平均値が計算上クリアされていても、背景に細かな木の葉や照明のきらめき等の高周波ノイズが存在すると、人間の視覚認知上エッジが干渉して文字が読めなくなる。
* **判定・対策:** 文字の群の矩形についてラプラシアン相当のエッジ分散（`edge_variance()`）を計測できるようにしてある。閾値（`HIGH_FREQUENCY_EDGE_VARIANCE`）を超える地では、縁取りではなく紙色のベールを濃くする。輪郭線は紙面の文法（罫線で区切る）に反するため使わない。

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