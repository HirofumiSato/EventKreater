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
        description="描画の積み。画面は選ばせず、常に classic（題は上・明細は下）",
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
        description="除外要素（text, letters, words, logos, watermark 等。題に必要な人物は除外しない）",
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
2. Safe negative prompts that keep image models from rendering lettering, without removing the people the event needs and without flattening a lively event into an empty room or a posed lineup.
3. Color styling parameters compatible with readability.

# Deliverable
One text-free background for a Japanese event flyer that is delivered to prospective participants by URL.
Framing: draw a 2:3 portrait image. It is then center-cropped to A4 portrait (1080x1528), so the top and bottom edges are lost. Keep the subject and every focal point inside the central 85% of the frame.
Every Japanese character is drawn later by a deterministic renderer; you design only the ground it sits on.
This is a flyer backdrop, not a poster: no typography, no layout mockups.

# Scene slots
The user message gives you role families, not a finished scene. Fill all the slots, then write image_prompt_en from them.
- activity_families: what happens. Several may apply; they combine with AND. Never let one erase another.
- motif_families: seasonal or holiday decoration. Add it as decoration; it never replaces the activity and never moves the event to another kind of place.
- setting_family: the kind of place. Keep the activity in that kind of place; never relocate it to a more familiar venue.
- people_policy: absent, atmosphere, or required.
- lighting_family: the light of the activity. It outranks design_direction.
- energy_family: the peak moment of the activity. It applies only while people are present; never use it to add people.

# Subject priority (highest first)
1. activity_families and motif_families: all of them, combined with AND. When energy_family is present, show each activity at the peak moment it names, never as a still life of its props.
2. title and title_nouns: keep every distinctive noun, including katakana loanwords. Classify leftover nouns into the slots above before you write the prompt.
3. setting_family, event_date, event_time, location: place, season, hour and light. They never replace an activity.
4. semantic_theme and design_direction: palette, color temperature and light only.
5. paper_character: how quiet the ground is. Never the scene type.

# How to read the event data
- activity_families: required kinds of action. Show each one as a recognisable activity, not as a still life of its props.
- motif_families: required seasonal decoration. Make it visible without turning the frame into a display of ornaments.
- setting_family: the venue type, without its proper name or signage.
- title_nouns: words from the title that no family covers yet. Read them, place each into a slot, and keep their meaning visible.
- title: the event's identity. A compound title is an AND, not an OR. Two short contrasting examples: a holiday name plus a body performance needs the holiday decoration AND the performance AND a performance space, not a holiday still life; a holiday name plus food needs the decoration AND a food setting, not a stage.
- event_date, event_time: infer season and time of day (19:00 -> night, 11月 -> autumn).
- location: infer the kind of place (bar, studio, hall, park, riverside) and indoor/outdoor cues.
- rain_policy: 屋内開催 -> indoor only; 雨天決行 -> outdoor is allowed.
- price, capacity: infer scale and tier (intimate vs large, premium vs casual). Never render them.
- target_generation: match the audience's age in styling, wardrobe, and energy when people appear. It never adds people to an event whose people_policy is absent.
- People in the scene are residents of Japan. Give them East Asian features and everyday Japanese clothing unless the event says otherwise. A neighbourhood market, a school event, or a family outing must not become a generic Western crowd.
- semantic_theme and design_direction: control palette, color temperature, and light only. Use the theme colour on props, clothing, and light; never flood the sky, the ground plane, or the whole frame with it.
- paper_character: the paper's character (quiet, soft, lively). It changes how quiet the ground is, never the scene type.
- lighting_family: the light of the activity. It outranks the theme's default light so an evening performance stays an evening performance.
- energy_family: the peak of the activity, only while people are present. crowd_peak = a packed floor with hands raised and saturated multi-coloured beams; dance_peak = a floor moving to modern pop or hip-hop, not a seated classical audience; game_peak = players cheering a winning move over boards and cards; celebration_peak = a cake with candles, applause and pulled crackers; shared_toast = glasses raised over shared dishes. Never an empty room, people standing still, or a posed group photo.

# People
- When people_policy is absent, keep people out of the main subject. Never replace the activity with a crowd.
- When people appear, never show a face turned to the camera, an identifiable face, or a close-up. Show them from behind, in three-quarter view, in profile, or in silhouette against the light. A crowd is a mass of backs, shoulders, and side profiles, not a row of portraits.
- Families appear as a group of adults and children, seen from behind, in three-quarter view, or in profile, with faces not readable.
- When energy_family is present, catch the action mid-motion: raised arms, leaning bodies, clapping hands. Keep it a crowded moment, never a posed lineup.

# Critical Constraints on image_prompt_en
1. ABSOLUTE FORBIDDEN: Do NOT include any instructions that ask the image model to write text, letters, titles, dates, numbers, or calligraphy.
2. COMPOSITION RULE: The image MUST have clear "negative space" (copyspace) planned for text overlays. Keep the top and bottom bands calm, low-frequency, and evenly lit: smooth sky, wall, foliage, or bokeh, with no faces, hands, or busy detail in them. The middle band is free for the subject.
3. SUBJECT FIDELITY: Name each required activity and motif explicitly, not only its mood. Do not reduce a compound event to its easiest single element. Do not reduce a jazz night to a single saxophone; show the band and the room where people listen.
4. DO NOT use the words poster, flyer, banner, headline, typography, logo, or menu in image_prompt_en; they bias the image model toward drawing type. Market stalls, food, and crowds are allowed; only painted lettering on them is excluded.
5. Do not place the subject or a strong focal point within 8% of the top or bottom edge; that area is cropped away.
6. Use concrete English props and places that fit the title. Invent the details from the title; do not copy examples from this instruction.

# Output Format
Output MUST be strict JSON adhering to the provided schema.
```

ユーザーメッセージに載せる項目は `src/domain/prompt_payload.py` の
`_CONTEXT_KEYS` で決める。`count` のような操作パラメータや未入力の項目は渡さない。
`composition_hint`（配置の余白指示と、A4 への切り抜きで上下が落ちる前提）も同じ
JSON に足し、LLM が構図を先に考えられるようにする。

題の中の固有語は `src/domain/visual_hints.py` が「催しの型」（活動・モチーフ・会場・
人物方針・光・活気）へ写し、辞書に無い語は原文のまま `title_nouns` として渡す。型は
小道具を固定しない。クリスマスツリーやライブハウスの内装のような具体物は、題の語を
読んだ LLM が `image_prompt_en` で決める。活気の型（`energy_family`）は人が居るとき
だけ決まり、活動を「静物」ではなく盛り上がりの頂点（満杯のフロアと挙がった手、
勝った瞬間の歓声、ケーキを囲む拍手）へ寄せる。`paper_character` は紙面の性格の表示名
（静けさ・やわらかさ・にぎやかさ）で、`style_2_warm_earth` のような ID の英語が
風景の指定と読まれるのを避ける。画面項目との対応表は :doc:`context_contract` にある。

---

## 3. 決定論的文字合成・幾何学レイアウトエンジン仕様

すべてのレンダリングは、**基準解像度 $1080 \times 1528\text{ px}$（A4 縦 210:297 / 画面・簡易印刷向け）** を絶対座標系として計算する。

### 3.1. 幾何学座標系とレイアウトグリッド

```text
(0,0) ────────────────────────────────────────────── (1080, 0)
 │  [Margin Top: 128px]                                  │
 │  [eyebrow: 日付]        22px / 字間 +4 / 見出しの群の色  │  H: 24
 │  [meta: 時刻]           34px / 見出しの群の色          │  H: 40
 │  [title: 催し名]        42〜163px / 行間 1.18 / 同じ色  │  最大 3 行
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
下の 3 列だけである。積みは 3 種とも `classic`（題は上、明細は下）に固定する。
写真は常にこの構図（上下の帯を空ける）で生成するので、紙面だけ別の積みにすると
題が被写体の上へ移動して読めなくなる。面（paper / band / full ink）は写真の上に
敷く半透明の矩形で、文字はその上に載る。

| パラメータ | 静けさ | やわらかさ | にぎやかさ |
| :--- | :--- | :--- | :--- |
| **主要フォント** | 明朝体・セリフ体（Noto Serif JP 等） | ゴシック体 Medium（Noto Sans JP 等） | 極太ゴシック体（M PLUS 1p Black 等） |
| **文字揃え** | 完全中央揃え | 左揃え | 左揃え |
| **積みの基準** | `classic`（上に題・下に明細） | `classic` | `classic` |
| **面** | 紙のまま（`veil` は紙色 0.55） | 紙を 7% 沈めた帯（明細の背後・`SURFACE_ALPHA` 0.82） | 墨の面（明細から下端まで・`SURFACE_ALPHA` 0.86） |
| **罫線** | 96 px / 2 px / 差し色 | 全幅 / 1 px / 墨の補助色 | 240 px / 6 px / 差し色 |
| **明細** | 中央に 3 行 | ラベル左・値右の 2 列 | 値 34 px を主役に |
| **タイトル上限** | 104 px | 83 px | 163 px |

`veil` の向きは文字の明度で決める。文字が地より明るければ墨の面の色、暗ければ
紙色の薄い幕を重ねる。暗い写真に白い題名を載せるときに、紙色を塗って文字ごと
沈める事故を防ぐ。幕の濃さは `veil_alpha()` が必要な最小の不透明度を返す。

面は写真を透かして敷く。帯 0.82・墨の面 0.86 が既定で、写真の地が濃くて墨が
4.5:1 に届かないときだけ `veil_alpha()` の値まで濃くする。面を敷いたら、面の
実色（透けた地との合成後の平均）を地として、面の上の文字色を `ensure_contrast()`
で決め直す。**面の上の文字を、面の外の地（写真）の平均色で決めてはならない。**
暗い写真の上では墨が白へ押し上げられ、明るい帯と同化する。

矩形の取り違えにも注意する。`PosterSlot.box` は (x, y, 幅, 高さ) で、矩形として
比べるのは `PosterSlot.area`（x1, y1, x2, y2）だけである。高さを下端と取り違えると、
詳細のスロットまで見出しの群の内側と判定される。

面の上の罫線は 4.5:1 を狙わない。面の実色と墨を 24% で混ぜ、文字より弱く地より
強い関係だけを保つ。面を透過すると罫線が地に沈むため、面の色から作り直す。

eyebrow（日付）は種目名を焼かず、日付だけを置く。利用者が入力していない
「ナイトイベント」等を紙面へ入れないためである。時刻（meta）はそのすぐ下に置き、
日付と 1 つの群にする。

見出しの群（日付・時刻・題名）の文字は 1 色にそろえる。階層は大きさと字間だけが
示す。役割ごとに差し色・補助色・墨へ分けると、同じ帯に載る 3 つの寄り先が写真に
よってばらけ（日付だけ鮮やかな水色、時刻は灰色、題は白）、題と地の関係が読めなく
なる。色は描画時に 1 回だけ決め、帯のいちばん不利なセルに合わせて 3 つとも同じ値で
描く。

差し色は既定では 1 箇所（見出し下の rule）だけに使い、大きな文字には使わない。
差し色を文字へ回す場合も必ず `safe_accent()` を通した値（紙に対して 4.5:1）を
使い、生の黄（`#FFD84D`）や藍（`#4F46E5`）をそのまま置かない。題名の色は画面から
受け取らず、描画時に `choose_title_color()` がベール後の地を見て決める。

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
    対して補正した墨をそのまま置くと、暗い写真の上で黒く沈む。そこで見出しの群を
    格子（6 列 × 4 行）に割り、**いちばん不利なセル**で `choose_title_color()` が
    墨か白を選ぶ。平均色は使わない。明るい空と暗い被写体が混ざった帯では、平均が
    4.5 を満たしても、白い字が明るい画素の上に残るためである。
    1. 画面は題名の色を指定しない（ステップ 5 は廃止した）。常に自動。
    2. 墨と白のうち、全セルの最小コントラストが高い方を採る。
    3. どちらも 4.5 に届かない帯では、ベールで地を寄せる（次項）。
*   **ベールの向き:** 文字が紙より明るければ墨の面の色（`surface_for(paper, "ink")`）、
    暗ければ紙を重ねる。白い題名の上に紙色を塗ると、選んだ色が読めなくなるため、
    見出しの群だけは「地を測る → 色を決める → ベールを敷く → 濃さを寄せる」の順で描く。
*   **動的補正ロジック:**
    文字の群（見出し / 詳細）ごとに、その矩形を格子に割って各セルの平均色を取る。
    **最小**のコントラストが 4.5 を下回るとき、文字色と同じ側の面の色を薄く重ねる
    （`veil_alpha_for_samples()`）。不透明度は 0.2 / 0.3 / … / 1.0 を順に試し、
    すべてのセルが 4.5 を満たした最初の値を使う。黒や白のスクリムを置かず、角丸の板も
    使わない。敷き切っても届かないとき（文字と敷く色が近いとき）は敷かない。届かない
    ベールを 1.0 で重ねると、地を塗り潰したうえで読めないままになる。
    墨の面（にぎやかさ）は面の色を、それ以外は紙の色を重ねる。
    `RenderMetadata.contrast_ratio` にも、平均ではなくこの最小値を残す。
*   **選ばれた色が読めないとき:** ベールで救えないほど地に近い色（例: 白い紙に `#EEEEEE`）は、
    `ensure_contrast()` でベール後の地に対して濃さを寄せる。寄せたかどうかは
    `RenderMetadata.title_color_adjusted` に残す。自動で選んだ墨か白は動かさない。
    帯に明るいビームと暗い地が同居して 1 色では届かないとき、最悪セル 1 点に合わせて
    反転させると、大多数の画素で読めないまま色だけが転ぶためである。
*   **ベールの向き:** 題が明るいときは、紙の明暗に関わらず黒へ寄せた紙を敷く。
    `surface_for(paper, "ink")` は紙が暗いテーマ（ネオン・夜のスレート）で明るい面を
    返すため、明るい題の上に明るいベールを敷くと 4.5 に届かず、ベールが敷かれない。
*   **差し色の補正:** 差し色は文字に使う前に `safe_accent()` を通す。紙に対して 4.5 を
    下回るときは、黒か白へ 5% ずつ寄せ、満たした時点で止める。色相は残し、明度だけを動かす。
    寄せる向きは地の明暗ではなく、**4.5 に届く側**で決める。地の相対輝度が 0.18〜0.5 の
    あいだ（写真の空や木肌）では白が届かない。それでも「地が暗めだから白」と決め打つと、
    文字色が白一色へ潰れて色相が消える。届く側が 1 つだけならそこへ、両方届くなら
    動かす歩数が少ない側へ寄せる。

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