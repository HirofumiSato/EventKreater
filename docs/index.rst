利用枠管理・課金決済基盤
========================

イベント告知・出欠と、主催者の利用枠・Stripe 決済を扱う Next.js アプリケーションの手順書です。
飯フェス、タコパ、ライブ、占い、撮影会などの主催者が、参加者へ直接URLを届ける用途を主対象にします。
ソースは ``docs/`` にあり、HTML は Sphinx で生成します。

このアプリは PostgreSQL を Prisma 経由で使います。画面確認の前に、データベースの作成とマイグレーションが必要です。

全体を 90 分で掴む順路は :doc:`onboarding`、どの文書が正かは :doc:`README` です。
全体の見取り図は :doc:`sitemap`、Stripe の手元確認は :doc:`stripe`、自動テストの読む順は :doc:`testing/index` です。

.. toctree::
   :maxdepth: 2
   :caption: 案内

   onboarding
   README
   sitemap

.. toctree::
   :maxdepth: 2
   :caption: 手順

   local
   deploy
   stripe
   database

.. toctree::
   :maxdepth: 3
   :caption: 検証

   testing/index

.. toctree::
   :maxdepth: 2
   :caption: 全体要件

   overall_system_requirements_common
   overall_system_requirements_common_review

.. toctree::
   :maxdepth: 2
   :caption: 共通ドキュメント

   DBschema
   backend_api_implementation_spec
   front_implementation_spec

.. toctree::
   :maxdepth: 2
   :caption: 機能別ドキュメント

   billing_and_quota_planning_requirements
   billing_and_quota_system_requirements
   pricing_campaign_requirements
   detailed_design_spec
   event-page/index
   flyer/index
   voice-input

.. toctree::
   :maxdepth: 2
   :caption: アーカイブ（実装前の設計）

   archive/index

.. toctree::
   :maxdepth: 2
   :caption: 課題

   issues/index

.. toctree::
   :maxdepth: 2
   :caption: UI 監査

   ui-review/home-audit
   ui-review/mock-sync
   ui-review/theme-review

.. toctree::
   :maxdepth: 2
   :caption: 索引（生成物）

   api-routes
   traceability

ドキュメントのビルド
--------------------

リポジトリ直下で実行します。初回だけ Python 仮想環境を作り、Sphinx を入れます。

.. code-block:: powershell

   npm run docs:install
   npm run docs

生成した HTML は ``docs/_build/html/`` に出力します。``docs/_build/`` は ``.gitignore`` の対象なので、リポジトリには含めません。入口は ``docs/_build/html/index.html`` です。
再ビルドは ``npm run docs`` だけで足ります。原稿を直したら、この HTML も作り直して内容を確認してください。

原稿に書いたリポジトリ内のパスが実在するかは、``npm run docs:links`` で確認します。失敗が 1 件でもあれば終了コードは 1 です。``scripts/check-doc-links.mjs`` が担当し、冒頭で「実装前の設計」と断っている文書は対象外にします。

索引は ``npm run docs:gen`` で作り直します。全原稿の一覧 ``docs/doc-index.json``、API と仕様の突き合わせ ``docs/api-routes.md``、コードから文書への逆引き ``docs/traceability.md``、AI 向けの入口 ``llms.txt`` の 4 つを生成します。生成物は手で編集せず、CI が最新かを検査します。

テストのファイル数と件数も生成物です。``npm run docs:counts`` が Vitest の結果から ``docs/testing/scope.rst`` へ書き戻し、``npm run check`` がずれを検出します。件数を持つページはここだけなので、他の文書では数を書きません。

編集するファイルは次のとおりです。

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - ファイル
     - 内容
   * - ``docs/onboarding.md``
     - 全体を掴む 90 分の順路。初見の開発者と AI が同じものを読む
   * - ``docs/README.md``
     - ドキュメントの派生・検証マップ。既知の乖離と、実装前の設計の一覧
   * - ``AGENTS.md``
     - AI エージェント向けの探索規則。正はコードであること、コマンド、規約
   * - ``docs/index.rst``
     - この目次
   * - ``docs/sitemap.rst``
     - ドキュメント全体の見取り図とサイトマップ
   * - ``docs/local.rst``
     - ローカル起動、環境変数、画面確認
   * - ``docs/deploy.rst``
     - 本番デプロイ。Cloudflare・Fly.io・Neon・R2 の順に設定する
   * - ``docs/stripe.rst``
     - Stripe のテストモード、課金の境界、Webhook
   * - ``docs/database.rst``
     - PostgreSQL、Prisma、利用枠の確認 SQL
   * - ``docs/testing/``
     - Next.js の自動テスト。読む順 11 ページ。``vitest/`` に実行基盤の 4 ページ、``scope.rst`` にテスト範囲のフロー
   * - ``docs/conf.py``
     - Sphinx の設定
   * - ``docs/requirements.txt``
     - Sphinx の Python 依存
   * - ``docs/billing_and_quota_planning_requirements.md``
     - 利用枠・課金の企画要件
   * - ``docs/billing_and_quota_system_requirements.md``
     - 利用枠・課金のシステム要件
   * - ``docs/pricing_campaign_requirements.md``
     - 価格キャンペーン、0円販売、無料期間の終了前通知、利用規約
   * - ``docs/overall_system_requirements_common.md``
     - 全体。機能横断の共通要件（境界、動線、画面カタログ、プラットフォーム管理者）
   * - ``docs/overall_system_requirements_common_review.md``
     - 全体。上記共通要件の実装前レビュー指摘
   * - ``docs/DBschema.md``
     - 共通。データベース物理設計
   * - ``docs/backend_api_implementation_spec.md``
     - 共通。バックエンド API 実装仕様
   * - ``docs/front_implementation_spec.md``
     - 共通。フロントエンド実装仕様
   * - ``docs/detailed_design_spec.md``
     - チラシ生成のシステム詳細設計
   * - ``docs/event-page/``
     - イベント告知ページと出欠管理。サービス紹介の LP とは別である。要件と設計は ``docs/archive/``
   * - ``docs/flyer/``
     - AI チラシ自動生成
   * - ``docs/archive/``
     - 実装前の企画要件・システム要件・詳細設計。**現在の正ではない**。索引とリンク検査の対象外
   * - ``docs/issues/``
     - 画面遷移・課金・運営まわりの課題。1 課題 1 ファイルで、受け入れ条件まで書く
   * - ``docs/api-routes.md``
     - 生成物。``src/app/api/**/route.ts`` と API 仕様の突き合わせ。``npm run docs:gen`` で作り直す
   * - ``docs/traceability.md``
     - 生成物。コードから文書への逆引きと、実在しないパス。``npm run docs:gen`` で作り直す
   * - ``docs/doc-index.json`` と ``llms.txt``
     - 生成物。AI が最初に引く索引。原稿を足したら ``npm run docs:gen``
