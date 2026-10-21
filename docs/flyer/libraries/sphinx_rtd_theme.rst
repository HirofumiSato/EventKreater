sphinx-rtd-theme
=================

目的
----

Sphinx が出力する HTML の見た目を、Read the Docs の左サイドバー付きレイアウトにします。文書の内容そのものはテーマと独立です。

使い方
------

``docs/conf.py`` でテーマ名を指定しています。

.. code-block:: python

   html_theme = "sphinx_rtd_theme"

パッケージが入っていないとビルドがテーマを見つけられず失敗します。``requirements.txt`` の ``sphinx-rtd-theme`` をインストールした環境でビルドしてください。

Tips
----

* 日本語の文言は ``language = "ja"`` が担当します。テーマを変えても検索インデックスの言語設定は残りません。両方を維持してください。
* テーマは HTML だけに影響します。クラス一覧や相互参照は Sphinx 本体の仕事です。
* 独自 CSS は今は置いていません。色や幅を変えるときは ``docs/_static`` を作り、``html_static_path`` と ``html_css_files`` を ``conf.py`` に追加します。
* テーマのバージョンを上げたあとは、``-E`` 付きでビルドし直すと古い CSS が残りません。
