CI への接続
===========

読む順の 11 番です。前は :doc:`local-run` です。このページは、``.github/workflows/ci.yml`` が何をして、どこまでを約束するかを書きます。

置き場所
--------

ワークフローはリポジトリ直下の ``.github/workflows/ci.yml`` に 1 本だけ置きます。トリガーは ``pull_request`` と ``main`` への ``push`` です。同じブランチの実行が重なったときは、前の実行を打ち切ります（``concurrency`` の ``cancel-in-progress``）。

権限は ``contents: read`` だけです。CI からリポジトリへ書く操作はしません。

ジョブは 2 つです。

.. list-table::
   :header-rows: 1
   :widths: 12 26 62

   * - ジョブ
     - 呼ぶコマンド
     - 見ているもの
   * - ``check``
     - ``npm ci`` のあと ``npm run check``
     - ESLint、``tsc --noEmit``、``tests/unit/`` の 94 件
   * - ``flyer``
     - ``pip install -r requirements.txt`` のあと ``python -m pytest -q``
     - ``services/flyer/tests/`` の描画・API・候補の試験

``check`` は手元と同じコマンドです。CI のためだけの別エントリは作りません。

check ジョブ
------------

``npm ci`` の ``postinstall`` が ``prisma generate`` を呼ぶので、Prisma Client の生成は別ステップにしません。``setup-node`` の ``cache: npm`` が ``package-lock.json`` をキーに ``node_modules`` を戻します。

環境変数はダミーで足ります。

.. code-block:: yaml

   env:
     DATABASE_URL: postgresql://ci:ci@127.0.0.1:5432/ci_placeholder
     JWT_SECRET: ci-only-placeholder-secret-value-not-used
     NEXT_PUBLIC_APP_URL: http://localhost:3012

``tests/setup/db.ts`` は ``TEST_DATABASE_URL`` があるときだけ ``DATABASE_URL`` を差し替えます。``check`` は ``TEST_DATABASE_URL`` を渡さないので、``tests/integration/`` の 10 件は skip され、DB へは接続しません。``DATABASE_URL`` は Prisma Client の生成が参照するだけです。

Stripe の秘密鍵、Webhook の署名鍵、Google のクライアント、OpenAI のキーは要りません。ジョブの秘密として登録する必要もありません。署名の試験は、テスト内のダミー鍵で完結します。

flyer ジョブ
------------

描画の試験は日本語フォントを読みます。``FontResolver.path_for`` は候補を順に見て、どれも開けなければ ``FontRenderError`` を投げます。Ubuntu のランナーには日本語フォントが入っていないので、``fonts-noto-cjk`` を apt で入れます。これを忘れると、手元では通るのに CI だけ落ちます。

``pip`` のキャッシュは ``services/flyer/requirements.txt`` をキーにします。``working-directory`` を ``services/flyer`` にしてあるので、``pip install`` と ``pytest`` はそのまま書けます。

落とし穴
--------

* **``TEST_DATABASE_URL`` を渡し忘れると、``tests/integration/`` は skip され、ジョブは緑になります。** ``check`` はあえて渡していません。DB の試験を緑の条件に入れるときは、下の「後で足すもの」の手順で別ジョブにします。
* ``npm ci`` は ``package-lock.json`` と ``package.json`` がずれていると落ちます。依存を足したら、lock も同じコミットに入れます。
* ``next lint`` は初回に ``.eslintrc.json`` を探します。設定ファイルを消したり移動したりすると、CI だけ落ちます。
* ``docs/_build/`` は ``.gitignore`` にあるので、Sphinx のビルドはジョブに入れていません。ドキュメントの検証は手元の ``npm run docs`` です。

後で足すもの
------------

``npm run test:db`` を足すときは、``check`` とは別のジョブにします。``check`` は 20 秒前後で終わる速い確認なので、PostgreSQL の起動待ちを混ぜません。

.. code-block:: yaml

   test-db:
     runs-on: ubuntu-latest
     services:
       postgres:
         image: postgres:16
         env:
           POSTGRES_PASSWORD: postgres
           POSTGRES_DB: event_platform_billing_test
         ports:
           - 5432:5432
         options: >-
           --health-cmd pg_isready
           --health-interval 10s
           --health-timeout 5s
           --health-retries 5
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: 20
           cache: npm
       - run: npm ci
       - run: npx prisma db push
         env:
           DATABASE_URL: postgresql://postgres:postgres@localhost:5432/event_platform_billing_test
       - run: npm run test:db
         env:
           TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/event_platform_billing_test

``services`` の ``options`` に ``pg_isready`` の healthcheck を付けます。これが無いと、PostgreSQL が接続を受け付ける前に ``prisma db push`` が走って落ちます。

``TEST_DATABASE_URL`` と ``DATABASE_URL`` には同じ値を入れます。片方だけだと ``tests/setup/db.ts`` が差し替えず、開発用の接続先を見に行きます。

``npm run test:e2e`` を足すときは、``npm run build`` のあと Playwright を呼びます。行程はローカル登録と、アカウントなしの出欠の二本です。

マージ前のゲートにする
----------------------

GitHub のブランチ保護で ``check`` と ``flyer`` を必須にすると、落ちたままの ``main`` が防げます。個人開発でも、触っていない領域の破壊（とくに ``services/flyer``）を検出できるのが利点です。

この節の先頭
------------

読む順は :doc:`index` に戻ります。実装を始めるときは :doc:`scope` の「これから書くテスト」から入ります。
