ドキュメントの構成
==================

このマニュアルは Sphinx のソースです。編集するのは ``docs/`` 以下の ``.rst`` と ``conf.py`` で、ブラウザで読む HTML はビルド結果です。

.. code-block:: text

   docs/
   ├── conf.py              言語、テーマ、autodoc の設定
   ├── index.rst            表紙と、左メニューになる目次
   ├── overview.rst         ガイド各ページ
   ├── architecture.rst
   ├── pipeline.rst
   ├── http_api.rst
   ├── rendering.rst
   ├── configuration.rst
   ├── development.rst
   ├── sphinx_structure.rst このページ
   ├── catchup/             ガイドを読む前の前提。index が読む順
   ├── libraries/           導入ライブラリ。index が一覧、他は 1 パッケージ 1 ページ
   ├── specs/               企画・要件・実装仕様・詳細設計の原文（Markdown）
   ├── testing/             テスト計画とテスト設計
   └── reference/           ソースから起こした API リファレンス

HTML は ``docs/_build/html/`` に出ます。このディレクトリは生成物なので、手で編集せず、Git の対象外です。

五つのまとまり
--------------

``index.rst`` の ``toctree`` が、左メニューの五つの見出しに対応します。``toctree`` に書いていないファイルは、メニューにも検索対象の本文にも入りません。仕様書は Markdown のまま ``myst_parser`` で取り込みます。

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - メニュー
     - 中身
   * - ガイドの前に
     - :doc:`/flyer/catchup/index` です。Web、画像、生成 AI、Python、設計用語に加え、アーキテクチャ・パイプライン・文字合成の各ガイド直前の前提です。サイドバーは ``collapse_navigation`` を無効にして、今開いている章以外も残します。
   * - ガイド
     - システムの振る舞いを文章で説明するページです。実装の読み方は :doc:`overview` から :doc:`development` へ進みます。
   * - 導入ライブラリ
     - :doc:`libraries/index` の表が、パッケージ名、目的、使い方概要です。名前は各パッケージのページへリンクしています。
   * - 仕様書
     - :doc:`/flyer/specs/index` です。企画要件、システム要件、実装仕様、詳細設計の原文です。実装仕様と詳細設計が実装の真実の源です。
   * - API リファレンス
     - :doc:`reference/index` 以下です。クラスと関数の説明は、ソースのドキュメンテーション文字列から ``automodule`` で取り込みます。

ガイドの各ページ
----------------

.. list-table::
   :header-rows: 1
   :widths: 28 72

   * - ページ
     - 書くこと
   * - :doc:`overview`
     - 何を入力し、何を返すか。確率的な背景生成と決定論的な文字描画の境界。
   * - :doc:`architecture`
     - ポートとアダプター、ディレクトリ、依存の向き。
   * - :doc:`pipeline`
     - 生成の 4 段階と、画像失敗時・LLM 失敗時の違い。
   * - :doc:`http_api`
     - エンドポイント、リクエスト例、HTTP ステータス。
   * - :doc:`rendering`
     - 1080×1920 のゾーン、フォントサイズ、コントラスト。
   * - :doc:`configuration`
     - 環境変数と TTL、保存先。
   * - :doc:`local_run`
     - 自分の PC で API を起動し、Swagger から 1 枚生成する手順。
   * - :doc:`swagger`
     - Swagger UI の画面の見方。Try it out から生成し、画像を開くまで。
   * - :doc:`testing/index`
     - テスト計画と、ケースの切り方。既存の ``tests/`` との対応。
   * - :doc:`development`
     - テスト、型チェック、HTML の再生成コマンド。

リファレンスの取り込み方
------------------------

``docs/conf.py`` がプロジェクトルートを ``sys.path`` に足し、ビルド時に ``src`` を import します。拡張は次の三つです。

* ``sphinx.ext.autodoc`` がモジュール内の公開クラスと関数を抜き出します。
* ``sphinx.ext.napoleon`` が Google 風・NumPy 風のドキュメンテーション文字列を解釈します。
* ``sphinx.ext.viewcode`` が HTML からソースを表示するリンクを付けます。

言語は ``ja``、HTML テーマは ``sphinx_rtd_theme`` です。テーマは見た目だけを担当し、ページ分割は ``toctree`` が担当します。

FastAPI を import する ``src/main.py``、``src/api/routes.py``、``src/api/errors.py`` は、現行の Pydantic と autodoc のローダーが衝突するため ``automodule`` にしていません。公開関数のシグネチャは :doc:`reference/http` に手で書いています。それ以外のリファレンスはソースが正です。説明を変えるときは RST ではなく、対象クラスのドキュメンテーション文字列を直してからビルドし直します。

ページを足すとき
----------------

1. ``docs/`` に ``.rst`` を置く。見出しの下線は見出し文字数以上にします。
2. 親の ``toctree`` に、拡張子なしのパスを足す。ガイドなら ``index.rst``、ライブラリなら ``libraries/index.rst``、リファレンスなら ``reference/index.rst`` です。
3. 他ページから参照するときは ``:doc:`ページ名 <相対パス>``` を使います。存在しない参照は警告になります。
4. プロジェクトルートで再生成します。

.. code-block:: powershell

   python -m sphinx -b html docs docs/_build/html

警告も失敗にしたいときは ``-W -E`` を足します。``-E`` は前回の解析キャッシュを使わず、全ページを読み直します。
