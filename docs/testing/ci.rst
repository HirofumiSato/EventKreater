CI への接続
===========

読む順の 11 番です。前は :doc:`local-run` です。このページは骨子で、ワークフローファイルはまだ置きません。

今呼ぶコマンド
--------------

ジョブが呼ぶコマンドは、手元と同じ ``npm run check`` です。中身は :doc:`vitest/index` のとおり、``lint``、``tsc --noEmit``、データベース不要の Vitest です。

このコマンドには、Stripe の秘密鍵、Webhook の署名鍵、Google のクライアント、OpenAI のキー、PostgreSQL は要りません。``STRIPE_SECRET_KEY`` をジョブの秘密として登録する必要もありません。署名の試験は、テスト内のダミー鍵で完結します。

後で足すもの
------------

``npm run test:db`` をジョブに足すときは、ジョブの中に PostgreSQL を作り、テスト用データベースへスキーマを流してから呼びます。開発用データベースの接続文字列は渡しません。

.. code-block:: yaml

   services:
     postgres:
       image: postgres:16
       env:
         POSTGRES_PASSWORD: postgres
         POSTGRES_DB: event_platform_billing_test
       ports:
         - 5432:5432

   steps:
     - run: npx prisma db push
       env:
         DATABASE_URL: postgresql://postgres:postgres@localhost:5432/event_platform_billing_test
     - run: npm run test:db
       env:
         TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/event_platform_billing_test

``test:db`` は ``check`` とは別のジョブにします。``check`` は 20 秒前後で終わる速い確認なので、PostgreSQL の起動待ちを混ぜません。

``npm run test:e2e`` を足すときは、``npm run build`` のあと Playwright を呼びます。行程はローカル登録と、アカウントなしの出欠の二本です。

実行方法は :doc:`local-run` のコマンドのままにします。CI のためだけの別エントリは作りません。

落とし穴
--------

* CI の PostgreSQL が起動しきる前に ``prisma db push`` を呼ぶと落ちます。healthcheck を付けるか、待ってから実行します。
* ``TEST_DATABASE_URL`` を渡し忘れると、``tests/integration/`` は skip され、**ジョブは緑になります**。件数の ``skipped`` を見るか、``test:db`` の後に「0 件でないこと」を確かめます。
* ``DATABASE_URL`` だけ渡して ``TEST_DATABASE_URL`` を渡さないと、``tests/setup/db.ts`` は何も差し替えません。両方に同じ値を入れます。

この節の先頭
------------

読む順は :doc:`index` に戻ります。実装を始めるときは :doc:`scope` の「これから書くテスト」から入ります。
