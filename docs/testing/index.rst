自動テスト
==========

この節は、利用枠・課金決済の Next.js アプリを手元で自動実行するときの文書です。読む順は 11 ページで、このページが 1 番です。

チラシ生成 API の pytest は :doc:`/flyer/testing/index` にあります。描画と OpenAI の確認はそちらが担当し、この節は Next.js 側の規則を担当します。

.. toctree::
   :maxdepth: 2
   :hidden:

   ideas
   design
   vitest/index
   scope
   first-cases
   local-run
   ci

.. rubric:: 読む順

次の順で読みます。左メニューの並びも同じです。

.. list-table::
   :header-rows: 1
   :widths: 8 26 66

   * - 順
     - ページ
     - 読むこと
   * - 1
     - このページ
     - 到達点と、後で CI が呼ぶコマンド
   * - 2
     - :doc:`ideas`
     - 何を自動で確かめるか。合格の定義
   * - 3
     - :doc:`design`
     - 層、外部 I/O の差し替え、ケースの切り方、ファイルの置き場所
   * - 4
     - :doc:`vitest/index`
     - Vitest とは何か、このリポジトリの設定、実行コマンド
   * - 5
     - :doc:`vitest/basics`
     - テストファイルの読み方。``describe``、``expect``、フック、モック
   * - 6
     - :doc:`vitest/run-cycle`
     - 起動から終了コードまでの流れ。図で追う
   * - 7
     - :doc:`vitest/practice`
     - テストを足す手順と、落ちたときの判断
   * - 8
     - :doc:`scope`
     - いまどこまで確かめられているか。次に書くもの
   * - 9
     - :doc:`first-cases`
     - このアプリで最初に書くケース
   * - 10
     - :doc:`local-run`
     - 手元での実行手順
   * - 11
     - :doc:`ci`
     - CI に載せるときの接続。ワークフローの中身と、緑になる条件

.. rubric:: 今の到達点

自動実行の入口は、リポジトリ直下の ``npm run check`` です。中身は ``lint``、``tsc --noEmit``、Vitest です。人が画面をクリックせず、Stripe の Dashboard も開かずに終わります。

テストは 31 ファイル、``it`` は 348 件です。内訳は ``tests/unit/`` が 22 ファイル 289 件、``tests/integration/`` が 9 ファイル 59 件です。``TEST_DATABASE_URL`` の無い環境では、結合の 59 件が skip され、289 件が実行されます。``npm test`` は 6 秒前後、``npm run check`` は 30 秒前後で終わります。

PostgreSQL が要る試験は ``npm run test:db``、ブラウザ行程は ``npm run test:e2e`` に分け、既定の ``check`` には入れません。``test:e2e`` はまだありません。CI は ``.github/workflows/ci.yml`` が、手元と同じ ``npm run check`` を呼びます。

現在の ``package.json`` にある自動実行は ``npm run lint``、``npm run typecheck``、``npm test``、``npm run test:watch``、``npm run test:db``、``npm run check`` です。``npm test`` は ``tests/`` の ``.test.ts`` 全体を集めます。``tests/integration/`` は ``TEST_DATABASE_URL`` があるときだけ中身が走り、無ければ skip されます。**skip は成功と同じ終了コードです。**

.. rubric:: これから書く順

読む順と、コードを書き始める順は別です。文書は上の 11 ページを順に読み、実装は次の順で足します。何をどのファイルに書くかは :doc:`scope` の表が正です。

1. ``tests/routes/`` を作り、``NextRequest`` と ``vi.mock("@/lib/prisma")`` で 1 本通す。ルート試験の土台です。
2. 未登録の 2 件目（403 ``REGISTER_REQUIRED``）、``viewer`` の 3 フラグ、幹事 GET の ``registered`` を足す。
3. ``ref`` の永続化と hydrate の応答を ``tests/integration/`` に足す。
4. ``jsdom`` と ``@testing-library/react`` を入れ、``include`` に ``**/*.test.tsx`` を足してから、勧誘カードと登録案内の 2 本を書く。
5. Playwright を入れ、ローカル登録と、アカウントなしの出欠を各 1 本通す。
6. CI の ``test-db`` ジョブで PostgreSQL を立て、``npm run test:db`` を ``check`` とは別に呼ぶ。手順は :doc:`ci` にある。

.. rubric:: 次に読む

:doc:`ideas`
