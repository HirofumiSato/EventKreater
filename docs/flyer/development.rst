開発
====

Python 3.11 以上です。依存の導入と API の起動手順は :doc:`local_run` にまとめています。何をどの粒度で確認するかは :doc:`testing/index`、実行コマンドは以下です。

テストと型
----------

.. code-block:: powershell

   python -m pytest tests/ -v
   python -m mypy

テストは外部 API を呼びません。キー未設定の組み立て、DALL-E のタイムアウトから静的背景への委譲、極端に短いタイトルと 40 文字のタイトルがタイトル枠に収まること、生成からダウンロードまでの HTTP を検証します。

``test_system_prompt_matches_implementation_spec`` はリポジトリ直下の ``docs/flyer/specs/implementation_spec.md`` を読みます。仕様書が無いツリー（サービスだけを置いた状態）では、その 1 件だけ理由を付けて省略します。

リポジトリ直下の Docker を立ち上げているなら、同じ一式をコンテナでも回せます。``docs/flyer/specs`` は読み取り専用で ``/repo`` に写るため、仕様書の照合も省略されません。

.. code-block:: powershell

   docker compose exec flyer python -m pytest -q
   docker compose exec flyer python -m mypy

ドキュメント
------------

HTML を生成します。リポジトリ直下で実行します。

.. code-block:: powershell

   python -m sphinx -b html docs/flyer docs/flyer/_build/html

``docs/flyer/make.bat html`` も同じビルドです。成果物は ``docs/flyer/_build/html/index.html`` です。ビルドは ``src`` を import するため、実行時の依存が入っている必要があります。

モジュールを追加したら、``docs/flyer/reference/`` の ``automodule`` にパスを足すと、クラスのドキュメンテーション文字列がリファレンスへ載ります。
