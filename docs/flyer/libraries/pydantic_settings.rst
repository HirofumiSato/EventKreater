pydantic-settings
=================

目的
----

API キー、タイムアウト、保存先、TTL、レート制限を環境変数から読みます。コードに秘密情報を書きません。

使い方
------

定義は :class:`src.infrastructure.config.Settings` です。フィールド名 ``openai_api_key`` は環境変数 ``OPENAI_API_KEY`` に対応します。

.. code-block:: powershell

   $env:OPENAI_API_KEY = "sk-..."
   python -m uvicorn src.main:app --reload

キーが未設定、または空白だけなら ``None`` になり、プロンプトと画像生成はモックになります。キーがあるときは ``gpt-4o-mini`` と DALL-E 3 を使います。

Tips
----

* コンストラクタに渡した値は環境変数より優先されます。テストは ``Settings(openai_api_key=None, storage_dir=tmp_path)`` のように渡し、開発マシンのキーで外部 API を呼ばないようにします。
* ``.env`` は読み込む設定にしていません。必要な値はプロセスの環境変数で渡してください。
* 保存先の既定値は、このファイルの位置から計算したプロジェクト直下の ``src/static/tmp`` です。カレントディレクトリがどこでも同じ場所になります。
* TTL の既定は 3600 秒、掃除間隔は 600 秒です。詳細設計の値であり、起動引数では変えません。変えるときは環境変数 ``TTL_SECONDS`` と ``CLEANUP_INTERVAL_SECONDS`` です。
