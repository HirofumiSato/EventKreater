Python プロジェクトの読み方
================================

:doc:`/flyer/architecture` のディレクトリ、:doc:`/flyer/configuration`、:doc:`/flyer/development` は、Python のファイルの置き方と実行の仕方を前提にしています。

ファイルとパッケージ
--------------------

``.py`` で終わるファイルがプログラムです。フォルダに ``__init__.py`` があると、そのフォルダはまとめて import できるパッケージになります。

``import`` は、別ファイルの関数やクラスを連れてくる文です。ガイドが「レンダラーは HTTP クライアントを import しない」と書くときは、文字を描くファイルが通信ライブラリを参照していない、という意味です。

``src/`` はこのアプリの本体です。先頭の ``src.main`` は ``src/main.py``、``src.api.routes`` は ``src/api/routes.py`` に対応します。ドットがフォルダの区切りです。

実行とパス
----------

コマンドは、プロジェクトの一番上（``requirements.txt`` がある場所）で打ちます。ここをカレントディレクトリと呼びます。場所が違うと ``src`` を見つけられません。

``python -m 何か`` は、「インストール済みの Python で、その道具を起動する」です。``uvicorn`` や ``pytest`` や ``sphinx`` の実行ファイルが PATH（コマンドを探す場所の一覧）に無くても、この形なら動きます。

環境変数
--------

環境変数は、プログラムの外から渡す名前付きの値です。API キーのように、ソースコードへ書きたくないものを入れます。``OPENAI_API_KEY`` が空なら、有料の外部サービスは呼ばず、代わりの仮実装が動きます。PowerShell では次のように設定します。

.. code-block:: powershell

   $env:OPENAI_API_KEY = "sk-..."

プロセスを起動したあとに変数を変えても、すでに動いているプログラムの設定は変わりません。

ガイドに出る開発コマンド
------------------------

.. list-table::
   :header-rows: 1
   :widths: 42 58

   * - コマンド
     - 何をするか
   * - ``python -m pip install -r requirements.txt``
     - 必要なライブラリをまとめて入れる
   * - ``python -m uvicorn src.main:app --reload``
     - API を起動する。``--reload`` はファイル保存のたびに再起動する開発向けの指定
   * - ``python -m pytest tests/ -v``
     - テストを実行する。外部の有料 API は呼ばない
   * - ``python -m mypy --strict src``
     - 本体の型の書き漏れを検査する
   * - ``python -m sphinx -b html docs docs/_build/html``
     - このマニュアルの HTML を作る

型ヒントは、関数が受け取る値と返す値の種類をソースに書いたものです。実行を速くする機能ではなく、間違いをツールで見つけるための注釈です。
