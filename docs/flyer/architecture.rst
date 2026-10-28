アーキテクチャ
==============

依存の向きは Ports & Adapters です。ユースケースはポート（抽象）だけを知り、OpenAI や Pillow の具象は ``src/main.py`` の組み立て時に注入します。

.. code-block:: text

   HTTP (src/api)
        │
        ▼
   GenerateFlyerUseCase
        │
        ├── PromptEnginePort ── OpenAIPromptEngine / MockPromptEngine
        ├── ImageGeneratorPort ── DalleImageGenerator / MockImageGenerator
        ├── FlyerRendererPort ── PillowFlyerRenderer
        ├── StoragePort ── LocalFileStorage
        └── 失敗時の背景 ── StaticFallbackImageGenerator

レンダラーモジュールは HTTP クライアントを import しません。プロンプトエンジンと画像生成は、レンダラーの座標計算を import しません。

ディレクトリ
------------

.. code-block:: text

   src/
   ├── main.py                 アプリケーションの組み立てと TTL 掃除
   ├── api/                    ルート、レート制限、例外の HTTP 変換
   ├── usecases/               生成パイプライン
   ├── domain/                 Pydantic モデルと例外
   ├── ports/                  抽象ポート
   ├── adapters/
   │   ├── prompt_engine/      gpt-4o-mini とモック
   │   ├── image_generator/    gpt-image-1 / dall-e-3、モック、静的背景
   │   ├── candidate_source/   AI 背景とローカル合成（グラデーション）
   │   └── renderer/           Pillow 合成と幾何計算
   └── infrastructure/         設定、ローカルファイル保存、AI 回数枠

``OPENAI_API_KEY`` が空、または未設定のときは、組み立て役がモックのプロンプトエンジンとモックの画像生成を選びます。キーがあるときは OpenAI の実装を選び、画像生成の失敗先として静的背景を同じインスタンスで渡します。

ステップ 2 の背景候補は別の分岐です。``AI_CANDIDATES_ENABLED`` が無効（``0``）、またはキーが無いときはローカル合成（グラデーション）だけを使います。有効なときは ``DalleCandidateSource`` が画像生成 API を呼び、失敗時は同じローカル合成へ委譲します。1 端末・1 時間の枚数は ``MemoryAiGenerationQuota`` が数えます。

テストで差し替えるときは ``src.main.create_app`` にポート実装を直接渡せます。
