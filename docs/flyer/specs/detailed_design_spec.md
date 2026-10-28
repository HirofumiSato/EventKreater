# システム詳細設計書

## プロジェクト: 小規模店舗・イベント主催者向け AIチラシ自動生成Webアプリ

### 対象: システム構造・クラスインターフェース・処理シーケンス・例外設計

## 1. 目的と設計原則

本設計書は、先行して策定された「企画要件定義書」「システム要件定義書」「実装仕様書」を基に、バックエンドおよびフロントエンドの実装者が迷いなくコードを記述できるレベルまで構造・振る舞いを具体化したものである。

### 1.1. 階層構造における本ドキュメントの位置づけ

```text
【最上位：企画要件】 ───── 誰の何を解決するか（Why / Value）
       ↓
【大枠：システム要件】 ─── 何を担保し、何を切り捨てるか（What / Boundary）
       ↓
【中間：実装仕様書】 ───── アルゴリズム、プロンプト、幾何学座標（Math / Spec）
       ↓
【細部：詳細設計書（本書）】 構造、クラス、シーケンス、例外、ライフサイクル（Architecture / Detail）
```

### 1.2. コア設計原則（Hexagonal Architecture / Ports & Adapters）

将来的な「Mac mini（ローカルLLM / ローカル画像生成）」へのゼロコスト移行を実現するため、ビジネスロジック（ドメイン層）を外部API（OpenAI, Replicate等）から完全に隔離する。

```text
       +-------------------------------------------------------+
       |                  Application Core                     |
       |                                                       |
       |  [FlyerOrchestratorService]                           |
       |         │                 │                 │         |
       +---------┼─────────────────┼─────────────────┼---------+
                 │                 │                 │
         <<Interface>>     <<Interface>>     <<Interface>>
           [LLMPort]       [ImageGenPort]    [RendererPort]
                 ▲                 ▲                 ▲
                 │                 │                 │
       +---------┼─────────────────┼─────────────────┼---------+
       |         │      Infrastructure Adapters      │         |
       |  [OpenAIAdapter]  [ReplicateAdapter]  [PillowAdapter] |
       |  [OllamaAdapter]  [ComfyUIAdapter]                    |
       +-------------------------------------------------------+
```

---

## 2. ディレクトリ構成とモジュール配置

Python (FastAPI) をベースとした責務分離型のディレクトリ構造である。

```text
app/
├── api/
│   ├── v1/
│   │   ├── endpoints/
│   │   │   ├── flyer.py            # POST /api/v1/flyers/generate
│   │   │   └── health.py           # GET /health
│   │   └── router.py
│   └── deps.py                     # 依存性注入（DIコンテナ）
├── core/
│   ├── config.py                   # 環境変数（pydantic-settings）
│   ├── security.py                 # レートリミット、バリデーションユーティリティ
│   └── exceptions.py               # カスタム例外定義
├── domain/
│   ├── models.py                   # 業務エンティティ・スキーマ（Pydantic）
│   ├── title_composition.py        # タイトルの意味改行（Pillow に依存しない）
│   └── semantic_theme.py           # テーマの色と明度
├── ports/                          # 抽象インターフェース（ABC）
│   ├── llm_port.py
│   ├── image_gen_port.py
│   ├── renderer_port.py
│   └── storage_port.py
├── adapters/                       # 外部接続アダプター（具象実装）
│   ├── llm/
│   │   ├── openai_adapter.py       # gpt-4o-mini実装
│   │   └── ollama_adapter.py       # Mac mini用 Ollama実装
│   ├── image_gen/
│   │   ├── replicate_adapter.py    # SDXL / Flux Schnell実装
│   │   ├── openai_dalle_adapter.py # DALL-E 3実装
│   │   └── comfyui_adapter.py      # Mac mini用 ComfyUI API実装
│   ├── renderer/
│   │   ├── design.py               # 目盛り・余白・色の役割・3 変奏（Pillow 非依存）
│   │   ├── poster.py               # build_poster_plan（純関数）と draw_poster
│   │   ├── layouts.py              # 積みの基準位置（split / top / center / bottom）
│   │   ├── layout_calculator.py    # fit_to_scale・コントラスト・文字計測
│   │   └── pillow_renderer.py      # 面 → plan → 描画 の 3 段
│   └── storage/
│       └── local_storage.py        # 一時ファイルI/O
├── services/
│   └── flyer_orchestrator.py       # パイプライン制御サービス
├── static/
│   ├── fonts/                      # NotoSans, NotoSerif, MPLUS (OFLライセンス)
│   └── default_backgrounds/        # フォールバック用静的テクスチャ画像（3種）
└── main.py                         # アプリケーション初期化・ライフサイクル
```

---

## 3. クラス設計とインターフェース定義（Ports）

### 3.1. ポート（抽象基底クラス）

```python
from abc import ABC, abstractmethod
from typing import BinaryIO
from app.domain.models import FlyerGenerationRequest, LLMGenerationContext

class LLMPort(ABC):
    @abstractmethod
    async def extract_visual_context(self, request: FlyerGenerationRequest) -> LLMGenerationContext:
        """入力情報から背景画像用プロンプトおよびスタイルパラメータを生成する"""
        pass

class ImageGenPort(ABC):
    @abstractmethod
    async def generate_background(self, prompt: str, negative_prompt: str, aspect_ratio: str) -> bytes:
        """指定プロンプトに基づき背景画像の生バイナリ（RGB）を取得する"""
        pass

class RendererPort(ABC):
    @abstractmethod
    def composite(
        self, 
        background_bytes: bytes, 
        request: FlyerGenerationRequest, 
        context: LLMGenerationContext
    ) -> bytes:
        """背景バイナリの上にテキスト・遮光マスクを決定論的に合成する"""
        pass

class StoragePort(ABC):
    @abstractmethod
    def save_temporary(self, file_id: str, image_bytes: bytes) -> str:
        """一時ストレージに保存し公開URIを返す"""
        pass

    @abstractmethod
    def cleanup_expired(self, ttl_seconds: int) -> int:
        """期限切れキャッシュを破棄し削除件数を返す"""
        pass
```

### 3.2. オーケストレーター（パイプライン制御クラス）

```python
import logging
from app.ports.llm_port import LLMPort
from app.ports.image_gen_port import ImageGenPort
from app.ports.renderer_port import RendererPort
from app.ports.storage_port import StoragePort
from app.domain.models import FlyerGenerationRequest, FlyerGenerationResponse

logger = logging.getLogger(__name__)

class FlyerOrchestratorService:
    def __init__(
        self,
        llm: LLMPort,
        image_gen: ImageGenPort,
        renderer: RendererPort,
        storage: StoragePort,
        fallback_bg_dir: str
    ):
        self.llm = llm
        self.image_gen = image_gen
        self.renderer = renderer
        self.storage = storage
        self.fallback_bg_dir = fallback_bg_dir

    async def execute(self, request: FlyerGenerationRequest) -> FlyerGenerationResponse:
        # Step 1: LLMによるメタ解釈・プロンプト生成
        context = await self.llm.extract_visual_context(request)
        
        # Step 2: 背景画像取得（フォールバック制御付き）
        try:
            bg_bytes = await self.image_gen.generate_background(
                prompt=context.image_prompt_en,
                negative_prompt=context.negative_prompt_en,
                aspect_ratio="9:16"
            )
            status = "success"
        except Exception as e:
            logger.warning(f"ImageGen failed, switching to static fallback: {e}")
            bg_bytes = self._load_fallback_background(request.template_id)
            status = "fallback_used"

        # Step 3: 決定論的文字合成レンダリング
        final_image_bytes = self.renderer.composite(
            background_bytes=bg_bytes,
            request=request,
            context=context
        )

        # Step 4: 一時保存とレスポンス構築
        import uuid
        file_id = str(uuid.uuid4())
        image_url = self.storage.save_temporary(file_id, final_image_bytes)

        return FlyerGenerationResponse(
            status=status,
            generation_id=file_id,
            image_url=image_url
        )

    def _load_fallback_background(self, template_id: str) -> bytes:
        import os
        path = os.path.join(self.fallback_bg_dir, f"{template_id}_default.png")
        with open(path, "rb") as f:
            return f.read()
```

---

## 4. 処理シーケンス設計

### 4.1. 正常系シーケンス（End-to-End）

```text
Client            API Endpoint        Orchestrator         LLMAdapter       ImageGenAdapter     RendererAdapter     StorageAdapter
  │                    │                    │                  │                   │                   │                  │
  │── POST /flyers ───>│                    │                  │                   │                   │                  │
  │   (JSON Body)      │── execute() ──────>│                  │                   │                   │                  │
  │                    │                    │── extract() ────>│                   │                   │                  │
  │                    │                    │<── Context JSON ─│                   │                   │                  │
  │                    │                    │                                      │                   │                  │
  │                    │                    │── generate_bg() ────────────────────>│                   │                  │
  │                    │                    │<── Raw PNG Bytes ────────────────────│                   │                  │
  │                    │                    │                                                          │                  │
  │                    │                    │── composite(bytes, request, ctx) ───────────────────────>│                  │
  │                    │                    │<── Final JPEG Bytes ─────────────────────────────────────│                  │
  │                    │                    │                                                                             │
  │                    │                    │── save_temporary(uuid, bytes) ─────────────────────────────────────────────>│
  │                    │                    │<── /static/tmp/{uuid}.jpg ──────────────────────────────────────────────────│
  │                    │<── Response ───────│
  │<── 200 OK ─────────│
  │   (image_url)      │
```

### 4.2. 外部画像APIタイムアウト時のフォールバックシーケンス

```text
Client            API Endpoint        Orchestrator      ImageGenAdapter      Local FS (Fallback)   RendererAdapter
  │                    │                    │                  │                      │                   │
  │── POST /flyers ───>│                    │                  │                      │                   │
  │                    │── execute() ──────>│                  │                      │                   │
  │                    │                    │── generate() ───>│                      │                   │
  │                    │                    │   (Wait 25s)     │                      │                   │
  │                    │                    │   [Timeout Err] ─X                      │                   │
  │                    │                    │                                         │                   │
  │                    │                    │── load_fallback(template_id) ──────────>│                   │
  │                    │                    │<── Default Background Bytes ────────────│                   │
  │                    │                    │                                                             │
  │                    │                    │── composite() ─────────────────────────────────────────────>│
  │                    │                    │<── Final JPEG Bytes ────────────────────────────────────────│
  │                    │<── Response ───────│
  │<── 200 OK ─────────│    (status: fallback_used)
```

---

## 5. 状態遷移とファイルライフサイクル設計

### 5.1. 一時ファイルの状態遷移

```text
[未作成]
   │
   │  Pillowレンダリング完了
   ▼
[CREATING] ──(アトミック書き込み: .tmp.uuid)──> [READY (公開)]
                                                    │
                               ┌────────────────────┴────────────────────┐
                               ▼                                         ▼
                     [ユーザーによる即時保存]                     [TTL(1時間)超過]
                               │                                         │
                               ▼                                         ▼
                     (ブラウザ側へダウンロード)                   [CLEANUP (自動物理削除)]
```

### 5.2. クリーンアップ・スケジューリング仕様

*   **保存先パス:** `app/static/tmp/{uuid4}.jpg`
*   **ライフサイクル制御:** FastAPI の `lifespan` イベント内で APScheduler または非同期ループタスクを起動。
*   **実行頻度:** 10分に1回。
*   **削除条件:** ファイルの最終変更日時（`mtime`）から `TTL = 3600秒` を経過したファイルを走査・削除。
*   **ディスク保護閾値:** ストレージ空き容量が 10% を下回った場合、TTL に関係なく経過時間が長い順に強制破棄（緊急パージ）。

### 5.3. ウィザード候補のライフサイクル

画面は「紙面の性格 → 背景 → 文字配置 → 配色 → タイトル色」の 5 ステップで候補を選ぶ。候補は
1 件につき 3 ファイルを持つ。ステップ 1 の 3 枚は同じサンプル紙面（`paper_ground`）を
共有し、書体・揃え・面の濃さだけを変えて並べる。地はテーマ色から決定論的に描く
紙面見本で、画像生成 API は呼ばない。ぼけ玉・偽の水平線・ビネットは持たない。

```text
static/candidates/
  {candidate_id}.jpg      完成イメージ（タイル表示と確定に使う）
  {candidate_id}.src.png  合成前の背景（子候補を描き直すために要る）
  {candidate_id}.json     CandidateMeta（親子関係・テンプレート・配置・配色・元の入力）
```

背景を残さず完成 JPEG だけ持つと、配置や配色を変えるたびに背景を作り直すことになる。
プレースホルダなら無料だが、AI 背景に替えると 1 枚あたり課金されるため、背景を
持たせて子候補は再合成だけにした。

*   **TTL:** `candidate_ttl_seconds`（既定 3600 秒）。画像・背景・メタのいずれかが古ければ 3 つまとめて消す。
*   **確定:** `POST /api/v1/flyers/generate` に `candidate_id` を渡す。完成 JPEG をそのまま一時保存へ複写するだけで、再描画しない。選んだタイルと保存結果がバイト単位で一致する。
*   **課金・回数:** ステップ 1・3・4・5 と写真の取り込みは消費しない。ステップ 2 の背景候補だけは、AI が有効なときに画像生成 API を呼ぶため、`AiGenerationQuotaPort` が 1 端末・1 時間あたり `ai_candidate_max_per_hour`（既定 3 枚）で数える。上限に達したときと生成に失敗したときは、グラデーション背景（`source` は `placeholder`）で 200 を返す。確定時の回数は従来どおり Next.js の BFF が `flyer_generation_logs` で数える。
*   **自分の写真:** `POST /api/v1/backgrounds` が `CandidateKind.BACKGROUND` の候補を 1 件作る。`ImageUploadPort` が JPEG / PNG / WebP の 8 MiB までを受け入れ、`Image.MAX_IMAGE_PIXELS` を 40,000,000 に固定してデコード爆弾を防ぐ。EXIF は向きだけ反映し、PNG へ書き直すときに落とす。背景は 1080×1528（A4 縦）の中央クロップで、`CandidateMeta.source` は `upload` になる。SVG・GIF・アニメーションは 422 `INVALID_IMAGE`、上限超過は 413 `UPLOAD_TOO_LARGE`。
*   **所有者:** `CandidateMeta.owner_token_hash` に BFF の端末トークンの SHA-256 を残す。画像取得・配置・配色・確定では `X-Flyer-Owner` と照合し、違えば 404 `CANDIDATE_EXPIRED` にする。所有者を持たないデプロイ前の候補は、TTL が切れるまで従来どおり読める。

### 5.4. 文字配置プリセット

`TextLayout` は「積みの基準位置」と「タイトルに許す高さ」の 2 つだけを持つ。
要素単位の微調整は許さない。座標を動かすとコントラスト保証と目盛りの前提が
崩れるためである。スロットの y は `adapters/renderer/poster.py` の
`build_poster_plan()` が 8 px の目盛りに載せて決める。

| `layout_id` | 意図 | 積みの基準（`StackAnchor`） | タイトル上限 |
| :--- | :--- | :--- | :--- |
| `classic` | 見出しは上、詳細は下。写真の主役が真ん中に残る（既定値） | `split` | 480 px |
| `top_stack` | 文字を上へ。下半分が空くので下に被写体を置ける | `top` | 440 px |
| `center_stack` | 中央に置く。上下に余白が残る | `center` | 440 px |
| `bottom_stack` | 文字を下へ。上半分が空くので上に被写体を置ける | `bottom` | 400 px |

`split` は見出しの群を `TOP_SAFE`（128）、詳細の群を `BOTTOM_SAFE` から上へ詰める。
見出しが大きすぎて重なるときは分割をやめ、続けて積む。`top` / `center` / `bottom`
は 2 つの群を続けて置き、その全体を上端・中央・下端へ寄せる。

配置で変えてよいのは重心だけである。スロットの順序（eyebrow → meta → title → rule →
facts → note）、文字の目盛り、群の中の間隔は 4 つで共通にする。日付（eyebrow）と
時刻（meta）は 1 つの群に置く。片方を上端、片方を下端へ離すと、いつ開く催しなのかを
目が 2 往復して読むことになる。

タイトルを行のどこで分けるかは `src/domain/title_composition.py` が決め、目盛りから
どの段を選ぶかは `layout_calculator.fit_to_scale()` が決める。最終行の右寄せ
（ぶら下げ）は左寄せの変奏でだけ使う。アルゴリズムは実装仕様 3.3 にある。

### 5.5. 差し色の引き継ぎ

ステップ 1〜3 の既定配色はテーマの差し色（`theme_palette`）で、`palette_id` は
`theme` になる。ステップ 4 は同じ色相から「基準 / 淡め / 深め / 控えめ」の 4 通りを
作り、いま選ばれている色を必ず先頭に置く。テーマ未選択のときは従来の 4 色
（gold / mono / neon / earth）を並べ替えて返す。並びが変わると、ステップ 3 で見た色と
確定後の色が食い違うためである。

### 5.6. タイトル色の引き継ぎ

`POST /api/v1/flyers/candidates/{candidate_id}/title-colors` は、選ばれた配色の候補を
親にして `CandidateKind.TITLE_COLOR` の 4 枚を返す。並びは `auto`（自動） / `ink`（墨） /
`white`（白） / `accent`（差し色）で固定し、先頭は必ず自動にする。題名の色は写真の
明るさで変わるため、迷ったら自動へ戻せる場所を先頭に置く。

* `auto` は `title_color` を `None` のまま描く。描画時に `poster.resolve_title_color()` が
  見出しの群の平均色から墨か白を選ぶ。候補の画像はこの時点で確定する。
* それ以外は `FlyerGenerationRequest.title_color` に HEX を入れて描く。選んだ色は
  動かさない。読みにくければベールの向きで地の側を寄せる。
* `CandidateMeta.title_color_id` に選択肢の ID を残す。確定は候補の JPEG を複写する
  だけなので、再描画は起きない。

---

## 6. 例外設計とエラーハンドリングマトリクス

システム内で発生する例外と、APIレスポンスおよびユーザー向け表示の対応マトリクス。

| 例外クラス | 発生契機 | HTTP Status | エラーコード | システム側アクション | クライアント向け通知文言 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `RequestValidationError` | 入力文字数超過、型不一致 | `422` | `INVALID_INPUT` | エラーフィールドをログ出力 | 入力内容を確認してください（文字数超過など） |
| `RateLimitExceeded` | ~~同一IPから短時間の連続リクエスト~~ **廃止** | ~~`429`~~ | ~~`RATE_LIMIT`~~ | 回数制限は BFF がイベント単位（公開前は下書き）で持つ | — |
| `CandidateNotFoundError` | 候補が無い、TTL 切れ、または所有者の不一致 | `404` | `CANDIDATE_EXPIRED` | 候補ファイルと所有者の照合 | 候補の有効期限が切れました。選び直してください。 |
| `ImageUploadError` | 未対応形式、破損、アニメーション画像 | `422` | `INVALID_IMAGE` | 形式と画素数の確認 | 画像を読み込めませんでした。JPEG / PNG / WebP の画像を選んでください。 |
| `ImageTooLargeError` | アップロード画像が 8 MiB 超 | `413` | `UPLOAD_TOO_LARGE` | 受信バイト数の確認 | 画像は8MB以下にしてください。 |
| `LLMContextGenerationError` | OpenAI API障害・JSONパース失敗 | `503` | `LLM_SERVICE_UNAVAILABLE` | エラーログ記録＋監視アラート | システム混雑のため処理を開始できませんでした。再試行してください |
| `ImageGenerationTimeoutError`| 画像生成APIの応答遅延（25秒超過） | `200` (※) | `FALLBACK_APPLIED` | 静的デフォルト背景に切り替えて合成 | （正常表示：ステータスのみ fallback_used を返却） |
| `FontRenderError` | フォントファイル読み込み破損 | `500` | `RENDER_FAILURE` | デフォルトシステムフォントへ退避 | 画像の文字合成に失敗しました。管理者に問い合わせてください |

*(※) 画像生成APIエラー時は、ユーザーにエラーを返さず静的フォールバック画像で200返却し、Time-to-Asset（生成完了）を死守する。*

---

## 7. 自己反証とトレードオフ分析

本設計において意図的に採用・棄却されたアーキテクチャ上の判断。

### 反証1: 非同期ワーカーキュー（Celery/Redis）の非採用

*   **批判:** 時間のかかる画像生成（15〜25秒）をWebリクエスト（HTTP接続）内で同期処理（待機）させると、コネクション枯渇やリバースプロキシ（Nginx/Cloudflare）のタイムアウト（504 Gateway Timeout）を招くのではないか？
*   **判定（MVPでの同期待機採用）:**
    *   RedisやCeleryを導入すると、個人店舗向け低コスト運用の前提（インフラ費用極小・Mac mini単体運用の平易性）が崩れる。
    *   FastAPIはASGIベースの非同期I/O（`async/await`）で駆動するため、外部API待機中にスレッドがブロックされず、メモリ消費は最小限に抑えられる。
    *   APIタイムアウト上限を**25秒**（リバースプロキシの一般的タイムアウト30〜60秒以内）に強制制限し、タイムアウト時は静的背景で即座に応答を返すことで504エラーを防止する。

### 反証2: クラウドオブジェクトストレージ（AWS S3）の非採用

*   **批判:** 生成画像をローカルファイルシステムに置く構成は、ステートフル（状態保持）となり水平スケール（サーバー並列化）を阻害するのではないか？
*   **判定（ローカル一時ストレージ採用）:**
    *   S3等のバケット接続は、追加のアクセスキー管理、通信レイテンシ、従量課金コストを発生させる。
    *   本アプリの画像は「生成直後にダウンロードして破棄される」前提の一時データ（TTL 1時間）であり、永続化の価値が極めて低い。
    *   ストレージ操作を `StoragePort` に抽象化しているため、将来マルチサーバー化が必要になった時点で `S3StorageAdapter` を差し替えるだけで対応可能。

### 反証3: フロントエンド直接API呼び出し（BaaS方式）の非採用

*   **批判:** ブラウザから直接 OpenAI や Replicate のAPIを呼べば、バックエンドサーバーを完全に排除（サーバーレス化）できるのではないか？
*   **判定（バックエンド経由採用）:**
    *   フロントエンドにAPIキーを露出させることはセキュリティ上不可。
    *   悪意あるユーザーによるプロンプト改ざん、API使い潰し（破産リスク）を防ぐレートリミットをブラウザ側だけで担保することは不可能。
    *   決定論的文字合成（Pillow）をサーバー側で行うハイブリッド方式の前提上、バックエンドは必須。

---

## 8. 【参考】難易度順の参照フレームワーク

本設計の理解、テスト自動化、および保守性を高めるための3段階の参照ソース。

*   **Step 1（基礎原理）: Robert C. Martin『Clean Architecture』**
    *   *視座:* 依存性の逆転原則（DIP）に基づき、ビジネスロジックがフレームワークや外部API（AI SDK）に依存しない境界設計を徹底する。
*   **Step 2（実装・実践）: Harry Percival, Bob Gregory『Architecture Patterns with Python』**
    *   *視座:* FastAPIとPydanticを用いたリポジトリパターン、サービス層、およびアダプターパターンの実践的なコード構造を適用する。
*   **Step 3（最先端の限界）: Michael Nygard『Release It! (2nd Edition)』**
    *   *視座:* サーキットブレーカー、タイムアウトバジェット、バルクヘッド（隔壁）パターンを用いて、外部AI APIの障害がシステム全体を巻き込んで停止する連鎖崩壊を防ぐ。