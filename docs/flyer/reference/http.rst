HTTP と起動
============

FastAPI を import するモジュールは、Sphinx の autodoc ローダーとインストール済み Pydantic の組み合わせで読み込めないため、ここはシグネチャを手で書いています。実装は ``src/main.py``、``src/api/routes.py``、``src/api/errors.py`` です。

.. py:function:: create_app(settings=None, prompt_engine=None, image_generator=None, renderer=None)

   :mod:`src.main` の組み立て関数。

   ``settings`` を省略すると環境変数から :class:`src.infrastructure.config.Settings` を読みます。
   ポートを渡すと、その実装を OpenAI や Pillow の代わりに使います。テストはこの引数でモックを注入します。

   戻り値は ``GET /health``、``POST /api/v1/flyers/generate``、``GET /api/v1/flyers/{flyer_id}`` を持つ FastAPI アプリケーションです。起動時に一時ファイルの掃除タスクを始めます。

.. py:function:: health()

   ``GET /health``。``{"status": "ok"}`` を返します。レート制限の対象外です。

.. py:function:: generate_flyer(body, request)

   ``POST /api/v1/flyers/generate``。

   ``body`` は :class:`src.domain.models.FlyerGenerationRequest` です。
   クライアント IP を数えてから :meth:`src.usecases.generate_flyer_usecase.GenerateFlyerUseCase.execute` を呼び、:class:`src.domain.models.FlyerGenerationResponse` を返します。

.. py:function:: download_flyer(flyer_id, request)

   ``GET /api/v1/flyers/{flyer_id}``。

   UUID の JPEG を ``image/jpeg`` で返します。不明な ID は 404、UUID でない値は 422 です。

.. py:function:: register_exception_handlers(app)

   リクエスト検証エラー、:class:`src.domain.exceptions.FlyerAppException`、想定外の例外を JSON の ``error_code`` と ``message`` に変換します。

レート制限
----------

.. automodule:: src.api.rate_limit
   :no-undoc-members:
