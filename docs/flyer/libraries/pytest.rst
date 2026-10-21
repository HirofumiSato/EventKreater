pytest
======

目的
----

ドメインの検証、文字が枠に収まること、アダプターのフォールバック、生成からダウンロードまでの HTTP を、外部 API なしで確認します。

使い方
------

プロジェクトルートで実行します。``pytest.ini`` が ``pythonpath = .`` を設定しているので、``src`` をインストールしなくても import できます。

.. code-block:: powershell

   python -m pytest tests/ -v

主なファイルは次のとおりです。

* ``tests/test_domain.py`` は文字数とサニタイズ、例外の HTTP 対応です。
* ``tests/test_renderer.py`` はコントラスト計算と、4 文字・40 文字のタイトルです。
* ``tests/test_adapters.py`` はモック切替、構造化出力、DALL-E のリトライと静的背景です。
* ``tests/test_api_integration.py`` は ``TestClient`` による結合と、TTL・ディスク逼迫時の削除です。

Tips
----

* テストを通すために閾値やアサーションを緩めないでください。失敗したら実装を直します。
* ストレージは ``tmp_path`` を渡します。開発用の ``src/static/tmp`` をテストが消しません。
* 画像生成のタイムアウト試験は、本番の 25 秒を待ちません。ジェネレータ生成時に ``timeout_seconds=0.2`` を渡します。
* ``python -m pytest`` を使ってください。``pytest`` 実行ファイルは PATH に無いことがあります。
