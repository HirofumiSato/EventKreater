導入ライブラリ
==============

実行、検証、ドキュメント生成に使っているパッケージです。バージョンの下限はプロジェクトルートの ``requirements.txt`` にあります。

.. list-table::
   :header-rows: 1
   :widths: 18 36 46

   * - ライブラリ
     - 目的
     - 使い方概要
   * - :doc:`FastAPI <fastapi>`
     - 生成とダウンロードの HTTP API を公開する
     - ``src/api/routes.py`` にルートを書き、``create_app`` で組み立てる。例外は JSON の ``error_code`` に変換する
   * - :doc:`Uvicorn <uvicorn>`
     - FastAPI を ASGI サーバーとして起動する
     - プロジェクトルートで ``python -m uvicorn src.main:app --reload`` を実行し、``/health`` と ``/docs`` を開く
   * - :doc:`Pydantic <pydantic>`
     - 入出力と LLM の構造化出力を同じスキーマで検証する
     - ``src/domain/models.py`` のモデルをリクエスト、``response_format``、描画メタデータに使う
   * - :doc:`pydantic-settings <pydantic_settings>`
     - API キーや TTL などの設定を環境変数から読む
     - :class:`src.infrastructure.config.Settings` を参照する。キーが空ならモックアダプターになる
   * - :doc:`Pillow <pillow>`
     - 背景の上に文字と遮光を決定論的に描く
     - ``src/adapters/renderer/`` が 1080×1920 の JPEG を返す。この層から外部 API は呼ばない
   * - :doc:`OpenAI <openai>`
     - 背景用プロンプトの構造化と DALL-E 3 による画像取得を行う
     - ``gpt-4o-mini`` の ``beta.chat.completions.parse`` と ``dall-e-3`` を、キーがあるときだけ使う
   * - :doc:`HTTPX <httpx>`
     - 生成画像の URL からバイト列を取得する
     - ``download_image`` が残り時間をタイムアウトにして取得する。テストは ``MockTransport`` を渡す
   * - :doc:`pytest <pytest>`
     - 外部 API なしで単体テストと結合テストを実行する
     - プロジェクトルートで ``python -m pytest tests/ -v`` を実行する
   * - :doc:`mypy <mypy>`
     - ``src`` の型ヒントを厳密に検査する
     - ``python -m mypy --strict src`` を実行する。テストは対象外
   * - :doc:`Sphinx <sphinx>`
     - ガイドと API リファレンスを HTML にする
     - ``python -m sphinx -b html docs docs/_build/html`` のあと ``docs/_build/html/index.html`` を開く
   * - :doc:`sphinx-rtd-theme <sphinx_rtd_theme>`
     - HTML を Read the Docs のレイアウトで表示する
     - ``docs/conf.py`` の ``html_theme`` に指定する。文書の言語設定とは独立している

.. toctree::
   :hidden:
   :maxdepth: 1

   fastapi
   uvicorn
   pydantic
   pydantic_settings
   pillow
   openai
   httpx
   pytest
   mypy
   sphinx
   sphinx_rtd_theme
