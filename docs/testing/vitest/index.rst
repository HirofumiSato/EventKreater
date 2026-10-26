Vitest
======

読む順の 4 番です。前は :doc:`../design`、次は :doc:`basics` です。

この章は、テストを実行する道具である Vitest そのものを説明します。何を確かめるかは :doc:`../ideas`、どう切るかは :doc:`../design`、いまどこまで書けているかは :doc:`../scope` です。

.. toctree::
   :maxdepth: 1
   :hidden:

   basics
   run-cycle
   practice

Vitest とは
-----------

Vitest は、Vite の変換器を使って TypeScript をそのまま実行するテストランナーです。``.test.ts`` を書いて ``npx vitest run`` を呼ぶと、次の四つを 1 コマンドで行います。

* TypeScript を変換する（``tsc`` で先に JavaScript を作らなくてよい）
* テストファイルを集める（``describe`` と ``it`` を集める）
* 実行して合否を出す
* 結果を件数と所要時間で報告し、失敗があれば終了コードを 1 にする

Jest と同じ書き味（``describe`` / ``it`` / ``expect``）で、設定が少なく、TypeScript とパスエイリアスの扱いが素直です。このリポジトリは ``vitest@3.2.7`` を使います。

このリポジトリの三つの約束
--------------------------

テストを足すときに迷わないよう、次の三つだけ決めています。

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - 約束
     - 中身
   * - 置き場所
     - ``tests/`` の下。``src/`` の隣に置き、製品コードと混ぜない
   * - 名前
     - ``対象.test.ts``。今の設定は ``.test.ts`` だけを集めるので、``.test.tsx`` は置いても動かない（:doc:`basics` の落とし穴）
   * - import
     - ``@/`` は ``src/`` を指す。``../../src/lib/...`` のような相対指定はしない

設定ファイル
------------

設定はリポジトリ直下の ``vitest.config.ts`` だけです。読み替えると次の四つを決めています。

.. list-table::
   :header-rows: 1
   :widths: 22 30 48

   * - 項目
     - 値
     - 意味
   * - ``resolve.alias``
     - ``@`` → ``./src``
     - ``tsconfig.json`` の ``paths`` を読み替える。テストから製品コードを import するときに使う
   * - ``test.include``
     - ``tests/**/*.test.ts``
     - 集めるファイル。``tests/`` の下の ``.test.ts`` だけ
   * - ``test.environment``
     - ``node``
     - ``document`` も ``window`` も無い。画面の試験には jsdom が要る
   * - ``test.setupFiles``
     - ``tests/setup/db.ts``
     - 各テストファイルより先に 1 回走る。``DATABASE_URL`` をテスト用に差し替える

``vite-tsconfig-paths`` のような追加プラグインは入れていません。``alias`` の 1 行で足りるためです。``tsconfig.json`` の ``paths`` を変えたときは、``vitest.config.ts`` の ``alias`` も同じ値に直します。片方だけ直すと、型検査は通るのに実行時だけ解決できない、という壊れ方をします。

.. mermaid::

   flowchart LR
       TS["tsconfig.json<br/>paths: @/* → ./src/*"] -.->|"同じ値を手で維持"| CFG["vitest.config.ts<br/>resolve.alias"]
       CFG --> RUN["vitest run"]
       DIR["tests/**/*.test.ts"] --> RUN
       SET["tests/setup/db.ts"] --> RUN
       RUN --> OUT["合否と終了コード"]

実行環境と、これからの層
------------------------

既定は Node です。Prisma、Stripe、``node:crypto`` を使うファイルは Node のままにします。

いまの設定に jsdom は入っていません。``tests/components/`` を作るときに、``jsdom`` と ``@testing-library/react`` を足し、``environment`` をファイル単位かディレクトリ単位で切り替えます。それまでは ``document`` を触るテストは書けません。

ブラウザを起動する試験は Vitest の担当外です。Playwright を別コマンド（``npm run test:e2e``）にし、``next build`` のあと ``next start`` したアプリを叩きます。既定の ``vitest run`` には混ぜません。理由は、ビルドとブラウザ起動で 1 回が数十秒かかり、実装中の待ち時間が読めなくなるためです。

コマンド
--------

``package.json`` の ``scripts`` は次のとおりです。

.. code-block:: json

   "typecheck": "tsc --noEmit",
   "test": "vitest run",
   "test:watch": "vitest",
   "test:db": "vitest run tests/integration",
   "check": "node scripts/check.mjs",
   "check:serial": "npm run lint && npm run typecheck && npm run test"

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - コマンド
     - いつ使うか
   * - ``npm run check``
     - 保存のたびの確認。ESLint（キャッシュ）、``tsc --noEmit``、UI の静的検査を並列で走らせる。**テストは走らせない**
   * - ``npm run check:full``
     - PR の前と CI。``check`` に Vitest と ``docs/testing/scope.rst`` の件数照合を足したもの
   * - ``npm run check:serial``
     - 同じ 3 つを順に走らせる。並列で落ちたときに、単体で再現させるため
   * - ``npm test``
     - Vitest だけを一度実行する。``tests/`` の ``.test.ts`` 全体が対象
   * - ``npm run test:watch``
     - 実装中。保存のたびに、変更の影響する範囲だけを再実行する
   * - ``npm run typecheck``
     - ``tsc --noEmit``。テストを走らせずに型だけ見る
   * - ``npm run test:db``
     - テスト用 PostgreSQL があるとき。``tests/integration/`` だけを実行する
   * - ``npm run test:e2e``
     - Playwright。まだありません。入れたときに足す

``npm test`` は ``tests/unit/`` 専用ではありません。``tests/integration/`` も集めますが、``TEST_DATABASE_URL`` が無ければ ``describe.skip`` で中身が実行されないだけです。**skip は成功と同じ終了コードになります**。この点は :doc:`run-cycle` で詳しく扱います。

章の読み方
----------

次の順で読みます。

* :doc:`basics` — テストファイルの読み方。``describe`` / ``it`` / ``expect`` の意味、フック、モック、つまずきやすい点
* :doc:`run-cycle` — ``npm test`` を叩いてから終了コードが返るまでの流れを図で追う
* :doc:`practice` — テストを足す手順、落ちたときの判断、レビュー観点

次に読む
--------

:doc:`basics`
