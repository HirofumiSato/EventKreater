アーカイブ（実装前の設計）
==========================

この章は、実装に入る前に書いた企画要件・システム要件・詳細設計を、履歴として残したものです。
**現在の正ではありません。** 実装と食い違う箇所があり、直す予定もありません。

現在の正は次のとおりです。食い違ったときは、必ずこちらを読んでください。

.. list-table::
   :header-rows: 1
   :widths: 30 34 36

   * - 対象
     - 正
     - 現在の解説
   * - DB 物理設計
     - ``prisma/schema.prisma``
     - :doc:`../DBschema`
   * - API 契約
     - ``src/app/api/**/route.ts``
     - :doc:`../backend_api_implementation_spec`
   * - 画面
     - ``src/app/**/page.tsx``
     - :doc:`../front_implementation_spec`
   * - チラシ描画
     - ``services/flyer/src/**``
     - :doc:`../flyer/specs/implementation_spec`
   * - 会員登録と認証の手順
     - ``src/modules/auth/**``
     - :doc:`../local` と :doc:`../database`
   * - イベント告知と出欠
     - ``src/app/events/[id]/page.tsx``
     - :doc:`../event-page/index`

アーカイブ配下の原稿は、冒頭に実装前の設計である旨の注意書きを置いています。
その注意書きがある原稿は ``npm run docs:gen`` の索引と ``npm run docs:links`` の検査から外れます。
AI に読ませる索引（``docs/doc-index.json``）でも ``preImplementation`` が立ちます。

.. toctree::
   :maxdepth: 2
   :caption: 会員登録管理

   user-management/index

.. toctree::
   :maxdepth: 2
   :caption: イベント告知ページ

   event-page/specs/event_page_planning_requirements
   event-page/specs/event_page_system_requirements
   event-page/specs/event_page_data_model_and_crud
   event-page/specs/event_page_db_schema_crud
   event-page/specs/backend_api_implementation_spec
   event-page/specs/event_page_frontend_implementation_spec
