ドキュメントの見取り図
================================

このページは、Sphinx が生成する HTML 全体の入口です。左メニューは ``docs/index.rst`` の ``toctree`` から作ります。``toctree`` に無いファイルはメニューにも検索対象の本文にも入りません。

衝突したときは仕様書を正とします。手順ページは起動と確認の順、検証ページは自動テストの読む順です。

読む順
------

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - 目的
     - 先に開くページ
   * - 全体を 90 分で掴む
     - :doc:`onboarding` 。人間と AI が同じ順路を使う
   * - どの文書が正か知る
     - :doc:`README` 。派生・検証マップと既知の乖離
   * - 初めて起動する
     - :doc:`local` → :doc:`database`
   * - 本番へ出す
     - :doc:`deploy` 。Cloudflare → Fly.io → Neon / R2 の順
   * - 決済を手元で試す
     - :doc:`stripe` 。鍵は ``sk_test_`` だけ。管理画面からは返金しない
   * - 自動テストの範囲を知る
     - :doc:`testing/index` 。Stripe の Dashboard は開かない
   * - 画面と API の正を追う
     - :doc:`overall_system_requirements_common` → :doc:`front_implementation_spec` と :doc:`backend_api_implementation_spec`
   * - 利用枠と Stripe 連携の仕様
     - :doc:`billing_and_quota_planning_requirements` → :doc:`billing_and_quota_system_requirements`
   * - 価格キャンペーンと利用規約
     - :doc:`pricing_campaign_requirements`
   * - イベント告知と出欠
     - :doc:`event-page/index`
   * - イベント作成の音声入力
     - :doc:`voice-input` 。右下のマイクボタンと OpenAI の音声認識、導入と上限
   * - チラシ生成 API
     - :doc:`flyer/index` 。章の地図は :doc:`flyer/sphinx_structure`
   * - 以前の要件と設計
     - :doc:`archive/index` 。**現在の正ではない**。コードが正

サイトマップ
------------

.. mermaid::

   flowchart TD
      Root["docs/index 表紙"] --> Guide["案内・手順"]
      Root --> Test["検証"]
      Root --> CommonReq["全体要件"]
      Root --> CommonDoc["共通ドキュメント"]
      Root --> Features["機能別"]

      Guide --> Onboard["onboarding 90 分の順路"]
      Guide --> DocMap["README 派生・検証マップ"]
      Guide --> Map["sitemap このページ"]
      Guide --> Local["local 起動と画面"]
      Guide --> Deploy["deploy 本番デプロイ"]
      Guide --> Stripe["stripe テスト決済"]
      Guide --> Db["database PostgreSQL"]

      Test --> TIndex["testing 読む順 11 ページ"]
      TIndex --> TVitest["vitest 章 4 ページ"]
      TIndex --> TScope["scope テスト範囲のフロー"]

      CommonReq --> Overall["共通要件とレビュー"]

      CommonDoc --> Schema["DBschema"]
      CommonDoc --> ApiSpec["backend / front 実装仕様"]

      Features --> Billing["利用枠・課金の要件"]
      Features --> Event["event-page"]
      Features --> Voice["音声入力"]
      Features --> Flyer["flyer"]
      Root --> Archive["archive 実装前の設計"]

      Root --> Gen["索引（生成物）"]
      Gen --> ApiRoutes["api-routes API と仕様の差分"]
      Gen --> Trace["traceability コードから文書へ"]

      Flyer --> FlyerMap["flyer/sphinx_structure"]

ページ一覧
----------

案内と手順
^^^^^^^^^^

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`onboarding`
     - 全体を掴む 90 分の順路。各段階に読むファイルと確認コマンドを置く
   * - :doc:`README`
     - 派生・検証マップ。どの文書が何を説明するか、既知の乖離、実装前の設計の一覧
   * - :doc:`index`
     - 表紙と左メニューの目次
   * - このページ
     - 全体の見取り図とサイトマップ
   * - :doc:`local`
     - ローカル起動、環境変数、画面パス、利用枠の優先順
   * - :doc:`deploy`
     - 本番デプロイ。Cloudflare、Fly.io、Neon、R2 の順に設定する。ローリング更新と切り戻し
   * - :doc:`stripe`
     - Stripe テストモード、課金の境界、Webhook、確認 SQL への案内
   * - :doc:`database`
     - PostgreSQL、Prisma、確認 SQL、ローカルだけの利用枠書き換え

検証
^^^^

Next.js 側の自動テストです。読む順は :doc:`testing/index` が正です。チラシ API の pytest は :doc:`flyer/testing/index` です。

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`testing/index`
     - 到達点と、後で CI が呼ぶコマンド
   * - :doc:`testing/ideas`
     - 何を自動で確かめるか。合格の定義。Stripe 画面は人手
   * - :doc:`testing/design`
     - 層、外部 I/O の差し替え、ケースの切り方、ファイルの置き場所
   * - :doc:`testing/vitest/index`
     - Vitest とは何か。設定、実行環境、``package.json`` の script
   * - :doc:`testing/vitest/basics`
     - テストファイルの読み方。``describe``、``expect``、フック、モック、落とし穴
   * - :doc:`testing/vitest/run-cycle`
     - 起動から終了コードまでの流れ。シーケンス図とフロー図 2 枚
   * - :doc:`testing/vitest/practice`
     - テストを足す 5 手順と、落ちたときの判断
   * - :doc:`testing/scope`
     - テスト範囲のフロー。画面遷移と手段の対応と、次に書くもの。件数を持つのはこのページだけ（`npm run docs:counts` が書き戻す）
   * - :doc:`testing/first-cases`
     - 最初に書くケース。Webhook は偽物の Stripe
   * - :doc:`testing/local-run`
     - 手元での実行。テストカードは含めない
   * - :doc:`testing/ci`
     - CI の接続。``check``・``db``・``flyer``・``docs`` の 4 ジョブ。Stripe の秘密鍵は登録しない

全体要件と共通ドキュメント
^^^^^^^^^^^^^^^^^^^^^^^^^^

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`overall_system_requirements_common`
     - 機能横断の共通要件。管理者の決済画面は閲覧のみ、価格キャンペーンは作成・編集・停止だけ
   * - :doc:`overall_system_requirements_common_review`
     - 上記の実装前レビュー指摘
   * - :doc:`DBschema`
     - 共通のデータベース物理設計
   * - :doc:`backend_api_implementation_spec`
     - 共通のバックエンド API 実装仕様
   * - :doc:`front_implementation_spec`
     - 共通のフロントエンド実装仕様

利用枠・課金
^^^^^^^^^^^^

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`billing_and_quota_planning_requirements`
     - 企画要件。無料 2 回、単発 299 円、月8回 980 円、作り放題 2,980 円
   * - :doc:`billing_and_quota_system_requirements`
     - システム要件。Checkout、Webhook、冪等性
   * - :doc:`pricing_campaign_requirements`
     - 価格キャンペーン、0 円単発、0 円月額、終了前通知、利用規約
   * - :doc:`stripe`
     - 手元でのテスト操作。仕様ではなく手順

イベント告知ページ
^^^^^^^^^^^^^^^^^^

入口は :doc:`event-page/index` です。

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`event-page/local-operations`
     - イベントページ機能のローカル起動と操作

要件と設計はアーカイブに移しました。現在の正はコードです。

音声入力
^^^^^^^^

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`voice-input`
     - イベント作成画面の右下のマイクボタン。OpenAI の音声認識の導入手順、環境変数、課金の上限、プライバシー

AI チラシ自動生成
^^^^^^^^^^^^^^^^^^

入口は :doc:`flyer/index`、章の地図は :doc:`flyer/sphinx_structure` です。

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - まとまり
     - ページ
   * - ガイドの前に
     - :doc:`flyer/catchup/index` 。:doc:`flyer/catchup/web`、:doc:`flyer/catchup/images`、:doc:`flyer/catchup/ai`、:doc:`flyer/catchup/python_project`、:doc:`flyer/catchup/architecture_words`、:doc:`flyer/catchup/before_architecture`、:doc:`flyer/catchup/before_pipeline`、:doc:`flyer/catchup/before_rendering`
   * - ガイド
     - :doc:`flyer/overview`、:doc:`flyer/architecture`、:doc:`flyer/pipeline`、:doc:`flyer/http_api`、:doc:`flyer/rendering`、:doc:`flyer/configuration`、:doc:`flyer/local_run`、:doc:`flyer/swagger`、:doc:`flyer/testing/index`、:doc:`flyer/development`
   * - 導入ライブラリ
     - :doc:`flyer/libraries/index` 。FastAPI、Uvicorn、Pydantic、Pillow、OpenAI、HTTPX、pytest、mypy、Sphinx など 1 パッケージ 1 ページ
   * - 仕様書
     - :doc:`flyer/specs/index` 。企画要件、システム要件、実装仕様、詳細設計
   * - API リファレンス
     - :doc:`flyer/reference/index` 。domain、ports、usecase、adapters、infrastructure、http
   * - ルートの詳細設計
     - :doc:`detailed_design_spec` 。チラシ生成のシステム詳細設計。flyer 配下の詳細設計と対になる

アーカイブ（実装前の設計）
^^^^^^^^^^^^^^^^^^^^^^^^^^

入口は :doc:`archive/index` です。**現在の正ではありません。** 実装と食い違う箇所があり、直す予定もありません。
食い違ったときは、:doc:`README` の表にある「現在の正」を読んでください。

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`archive/user-management/index`
     - 会員登録管理。企画要件からこの PC での起動まで
   * - :doc:`archive/user-management/planning_requirements`
     - 会員登録の企画要件
   * - :doc:`archive/user-management/system_requirements`
     - 会員登録のシステム要件
   * - :doc:`archive/user-management/DBschema`
     - 会員登録のデータベース設計
   * - :doc:`archive/user-management/detailed_design_spec`
     - 会員登録の詳細設計
   * - :doc:`archive/user-management/backend_api_implementation_spec`
     - 会員登録のバックエンド API 実装仕様
   * - :doc:`archive/user-management/front_implementation_spec`
     - 会員登録のフロントエンド実装仕様
   * - :doc:`archive/user-management/local_development_setup`
     - 当時のローカル開発セットアップ。現在は :doc:`local`
   * - :doc:`archive/user-management/local_environment`
     - 当時のローカル環境。URL は 3000 で、現在の 3012 と違う
   * - :doc:`archive/event-page/specs/event_page_planning_requirements`
     - イベントページの企画要件
   * - :doc:`archive/event-page/specs/event_page_system_requirements`
     - イベントページのシステム要件
   * - :doc:`archive/event-page/specs/event_page_data_model_and_crud`
     - データモデルと CRUD
   * - :doc:`archive/event-page/specs/event_page_db_schema_crud`
     - DB スキーマと CRUD
   * - :doc:`archive/event-page/specs/backend_api_implementation_spec`
     - イベントページのバックエンド API 実装仕様
   * - :doc:`archive/event-page/specs/event_page_frontend_implementation_spec`
     - イベントページのフロントエンド実装仕様

UI 監査と生成された索引
^^^^^^^^^^^^^^^^^^^^^^^^^

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - ページ
     - 中身
   * - :doc:`ui-review/home-audit`
     - ホーム画面（SCR-PUB-00）の UI/UX 監査
   * - :doc:`ui-review/mock-sync`
     - 製品の DOM からモックを生成する手順（``npm run mock:sync``・同期漏れの止め方）
   * - :doc:`api-routes`
     - 生成物。``src/app/api/**/route.ts`` と API 仕様の突き合わせ
   * - :doc:`traceability`
     - 生成物。コードから文書への逆引きと、文書が指す実在しないパス

``docs/doc-index.json`` と ``llms.txt`` も ``npm run docs:gen`` の生成物ですが、Sphinx のページではありません。

ビルド
------

リポジトリ直下で ``npm run docs`` です。初回だけ ``npm run docs:install`` が要ります。
生成物は ``docs/_build/html/index.html`` です。ページを足したら、このページの表と親の ``toctree`` の両方を更新します。
原稿に書いたリポジトリ内のパスは ``npm run docs:links`` で検査します。
索引は ``npm run docs:gen`` で作り直します。生成物に差分が出たら、原稿かコードを直してから再生成し、差分ごとコミットします。
テストの件数は ``npm run docs:counts`` が ``docs/testing/scope.rst`` へ書き戻します。件数を持つのはこのページだけです。
