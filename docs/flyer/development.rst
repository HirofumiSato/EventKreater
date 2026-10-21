開発
====

Python 3.11 以上です。依存の導入と API の起動手順は :doc:`local_run` にまとめています。何をどの粒度で確認するかは :doc:`testing/index`、実行コマンドは以下です。

テストと型
----------

.. code-block:: powershell

   python -m pytest tests/ -v
   python -m mypy --strict src

テストは外部 API を呼びません。キー未設定の組み立て、DALL-E のタイムアウトから静的背景への委譲、極端に短いタイトルと 40 文字のタイトルがタイトル枠に収まること、生成からダウンロードまでの HTTP を検証します。

ドキュメント
------------

HTML を生成します。

.. code-block:: powershell

   python -m sphinx -b html docs docs/_build/html

``docs/make.bat html`` も同じビルドです。成果物は ``docs/_build/html/index.html`` です。ビルドは ``src`` を import するため、実行時の依存が入っている必要があります。

モジュールを追加したら、``docs/reference/`` の ``automodule`` にパスを足すと、クラスのドキュメンテーション文字列がリファレンスへ載ります。
