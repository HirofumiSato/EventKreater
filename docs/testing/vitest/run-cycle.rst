起動のサイクル
==============

読む順の 6 番です。前は :doc:`basics`、次は :doc:`practice` です。

``npm test`` を叩いてから終了コードが返るまでに、何がどの順で起きるかを追います。図のあとに、各段で何が起きるかの表と、終了コードの罠を置きます。

1 回の実行
----------

``npm test`` は ``vitest run`` を呼び、1 回で終わります。watch はしません。

.. mermaid::

   sequenceDiagram
       autonumber
       participant Dev as 開発者
       participant NPM as npm
       participant VIT as Vitest
       participant CFG as vitest.config.ts
       participant SET as tests/setup/db.ts
       participant TST as テストファイル
       participant DB as PostgreSQL
       participant REP as レポーター
       Dev->>NPM: npm test
       NPM->>VIT: vitest run
       VIT->>CFG: 設定を読む
       CFG-->>VIT: alias @ から src / tests の .test.ts / node / setupFiles
       VIT->>VIT: TypeScript を変換する
       VIT->>SET: setupFiles を実行する
       SET-->>VIT: DATABASE_URL を TEST_DATABASE_URL に差し替える
       VIT->>TST: import して集める
       TST->>TST: describe と it を登録する
       TST->>TST: describe.skip の判定を評価する
       VIT->>TST: it を順に実行する
       TST->>DB: 結合テストだけ読み書きする
       DB-->>TST: 行
       TST-->>REP: 成功または失敗
       REP-->>Dev: 件数と所要時間と終了コード

各段で起きること
----------------

.. list-table::
   :header-rows: 1
   :widths: 16 24 60

   * - 段
     - 担当
     - 起きること
   * - 1
     - ``npm``
     - ``package.json`` の ``test`` を引く。このリポジトリでは ``vitest run``
   * - 2
     - Vitest
     - ``vitest.config.ts`` を読む。``alias`` ``include`` ``environment`` ``setupFiles`` の 4 つが決まる
   * - 3
     - Vite
     - ``.test.ts`` を esbuild で変換する。型検査はしない。型は ``tsc --noEmit`` の担当
   * - 4
     - ``tests/setup/db.ts``
     - すべてのテストより先に 1 回走る。``TEST_DATABASE_URL`` があれば ``DATABASE_URL`` を上書きする
   * - 5
     - Vitest
     - ``include`` に合うファイルを import する。この時点で製品コードの import も評価される
   * - 6
     - テストファイル
     - ``describe`` と ``it`` を登録する。``describe.skip`` はここで中身を捨てる
   * - 7
     - Vitest
     - ``it`` を実行する。1 件が落ちても残りは続く
   * - 8
     - Prisma
     - 結合テストだけ、``DATABASE_URL`` の先へ実際に読み書きする
   * - 9
     - レポーター
     - 件数、所要時間、失敗の一覧を出す。失敗が 1 件でもあれば終了コード 1

watch のサイクル
----------------

``npm run test:watch`` は、保存のたびに影響する範囲だけを再実行します。実装中はこちらを使います。

.. mermaid::

   flowchart TD
       A["npm run test:watch"] --> B["初回は対象を全部実行する"]
       B --> C{"結果"}
       C -->|成功| D["待機する"]
       C -->|失敗| E["失敗した it の名前を読む"]
       E --> F["実装かテストを直す"]
       D --> G["ファイルを保存する"]
       F --> G
       G --> H["Vitest が変更を検知する"]
       H --> I["依存グラフから影響するファイルだけ再実行する"]
       I --> C

初回は全部走るので、ファイルを 1 つ増やしたときも拾われます。ただし、**新しく作ったファイルは、保存するまで気づかれません**。件数が増えないときは、一度 ``q`` で抜けて ``npm test`` をやり直します。

どのコマンドを選ぶか
--------------------

.. mermaid::

   flowchart TD
       S["何を確かめたいか"] --> Q1{"DB の制約・行ロック・件数を見るか"}
       Q1 -->|はい| D["npm run test:db<br/>TEST_DATABASE_URL が必須"]
       Q1 -->|いいえ| Q2{"HTTP の応答を見るか"}
       Q2 -->|はい| R["npm test<br/>tests/routes に置く（これから）"]
       Q2 -->|いいえ| Q3{"画面の文言を見るか"}
       Q3 -->|はい| C2["npm test<br/>jsdom 導入後に tests/components（これから）"]
       Q3 -->|いいえ| U["npm test<br/>tests/unit の純粋関数"]
       D --> F["一区切りで npm run check"]
       R --> F
       C2 --> F
       U --> F

終了コードの罠
--------------

終了コード 0 は「失敗が無かった」であって、「確かめた」ではありません。次の 3 つは 0 で終わります。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 状況
     - 起きること
   * - 集まったテストが 0 件
     - ``No test files found`` と出るが、設定によっては 0 で終わる。``include`` の拡張子違い（``.test.tsx``）でよく起きる
   * - すべて skip
     - ``TEST_DATABASE_URL`` が無い日の ``tests/integration/`` がこれ。件数は出るが中身は走っていない
   * - ``await`` の無い ``expect(...).rejects``
     - 失敗を待たずに ``it`` が終わる。テストは常に成功する

``npm run test:db`` を単独で走らせたときは、結果の ``skipped`` の数を見ます。0 でなければ、DB を見ていません。

所要時間の目安
--------------

手元の実測です。``tests/unit/`` の 289 件が実行され、``tests/integration/`` の 59 件は skip されて、``npm test`` は 6 秒前後で終わります。``npm run check`` は ESLint と ``tsc`` を同時に走らせるので 15 秒前後です。順に走らせていたころは 30 秒から 34 秒でした。

結合テストを実行すると、1 件あたり数十ミリ秒から数百ミリ秒になります。テスト用 DB が遠い場所にあると、ここが支配的になります。

次に読む
--------

:doc:`practice`
