Sphinx
======

目的
----

ガイドと API リファレンスを HTML にします。クラスの説明は、ソースのドキュメンテーション文字列を ``sphinx.ext.autodoc`` で取り込みます。

使い方
------

プロジェクトルートで実行します。

.. code-block:: powershell

   python -m sphinx -b html docs docs/_build/html
   start docs\_build\html\index.html

``docs\make.bat html`` も同じです。設定は ``docs/conf.py``、言語は日本語、テーマは Read the Docs です。

Tips
----

* ``sphinx-build`` が PATH に無いときは ``python -m sphinx`` を使います。
* ビルドは ``src`` を import します。先に ``requirements.txt`` をインストールしてください。
* 警告を見逃さないときは ``python -m sphinx -b html -W -E docs docs/_build/html`` です。``-E`` はキャッシュを使わず読み直します。
* FastAPI を autodoc で import すると、現行の Pydantic との組み合わせで失敗します。HTTP の公開関数は ``docs/reference/http.rst`` に手書きしています。FastAPI を import しないモジュールは ``automodule`` のままです。
* ページを足したら ``docs/index.rst`` か、配下の ``index.rst`` の ``toctree`` にファイル名を追加します。一覧に無い RST は HTML に出ません。
* 生成物の ``docs/_build/`` はコミットしません。
