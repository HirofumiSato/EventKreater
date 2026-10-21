FastAPI
=======

目的
----

チラシ生成とダウンロードを HTTP で公開します。入力の形は Pydantic モデルが検証し、ドメイン例外は JSON の ``error_code`` と利用者向け文面に変換します。

使い方
------

ルートは ``src/api/routes.py``、アプリの組み立ては ``src/main.py`` の ``create_app`` です。

* ``GET /health`` は死活確認です。レート制限の対象外です。
* ``POST /api/v1/flyers/generate`` は :class:`src.domain.models.FlyerGenerationRequest` を受け、:class:`src.domain.models.FlyerGenerationResponse` を返します。
* ``GET /api/v1/flyers/{flyer_id}`` は完成 JPEG を返します。

テストでは ``fastapi.testclient.TestClient`` に ``create_app`` の戻り値を渡します。プロンプトエンジン、画像生成、レンダラーは ``create_app`` の引数で差し替えます。

Tips
----

* ルート関数に OpenAI や Pillow の呼び出しを直接書かないでください。依存はポート経由でユースケースに渡します。
* 例外ハンドラは ``src/api/errors.py`` にまとまっています。新しいドメイン例外は :class:`src.domain.exceptions.FlyerAppException` の ``http_status`` と ``error_code`` を持てば、個別のハンドラを足さずに JSON になります。
* ``ImageGenerationTimeoutError`` をルートまで漏らさないでください。ユースケースが静的背景へ切り替えて 200 を返します。
* Swagger UI は起動後の ``/docs`` です。スキーマはリクエストモデルの ``Field`` から生成されます。
