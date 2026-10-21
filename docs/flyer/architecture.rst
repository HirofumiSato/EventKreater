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
   │   ├── image_generator/    DALL-E 3、モック、静的背景
   │   └── renderer/           Pillow 合成と幾何計算
   └── infrastructure/         設定とローカルファイル保存

``OPENAI_API_KEY`` が空、または未設定のときは、組み立て役がモックのプロンプトエンジンとモックの画像生成を選びます。キーがあるときは OpenAI の実装を選び、画像生成の失敗先として静的背景を同じインスタンスで渡します。

テストで差し替えるときは ``src.main.create_app`` にポート実装を直接渡せます。
