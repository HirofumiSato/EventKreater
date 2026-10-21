手元での実行
============

読む順の 10 番です。前は :doc:`first-cases`、次は :doc:`ci` です。

前提
----

Node.js 20、npm、リポジトリ直下で ``npm install`` が終わっていることです。``package.json`` には :doc:`vitest/index` の ``typecheck``、``test``、``test:watch``、``test:db``、``check`` が入っています。

開始条件は、依存のインストールが終わり、``@/*`` が ``src/`` を指せることです。終了条件は、収集されたテストがすべて成功し、:doc:`ideas` の数値を変えて通していないことです。

コマンド
--------

.. code-block:: powershell

   npm run check

一区切りの確認です。ESLint、``tsc --noEmit``、データベース不要の Vitest が順に走ります。

実装中は、関連ファイルの保存で再実行します。

.. code-block:: powershell

   npm run test:watch

Vitest だけを一度実行するときは ``npm test``、型だけ見るときは ``npm run typecheck`` です。

テスト用データベース
--------------------

``tests/integration/`` を実行するときだけ必要です。PostgreSQL 14 以降を用意し、開発用とは別のデータベースを作ります。

.. code-block:: powershell

   createdb event_platform_billing_test

   $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/event_platform_billing_test"
   npx prisma db push

   $env:TEST_DATABASE_URL = $env:DATABASE_URL
   npm run test:db

``TEST_DATABASE_URL`` は ``tests/setup/db.ts`` が ``DATABASE_URL`` に上書きします。**開発用のデータベースを指すと、開発用の行がそのまま消えます。** ``event_platform_billing`` は指定しないでください。必ずテスト用のデータベースを指定します。

``npm run test:db`` を省いた場合、``tests/integration/`` は skip されます。エラーにはなりません。

一部だけ実行する
----------------

ファイルを指定します。

.. code-block:: powershell

   npx vitest run tests/unit/problem.test.ts

``it`` の名前で絞ります。

.. code-block:: powershell

   npx vitest run -t "24時間"

``--reporter=verbose`` を足すと、``it`` の名前が 1 件ずつ出ます。

ブラウザ行程を入れたあとは、アプリをビルドしてから ``npm run test:e2e`` を実行します。Stripe のテストカードや Google の画面は、ここには含まれません。起動は :doc:`/local`、テスト決済は :doc:`/stripe` です。

失敗したとき
------------

失敗の名前に、崩れた条件が書いてあります。期待のステータスや文字数を書き換えて成功扱いにしません。実装側の分岐を直します。

まず、次の 3 つを疑います。

* **件数が 0。** ``include`` が ``tests/**/*.test.ts`` なので、``.test.tsx`` や ``tests/`` の外のファイルは集められません。
* **skip が全部。** ``TEST_DATABASE_URL`` が無い状態です。終了コードは 0 ですが、DB を見ていません。
* **開発用 DB を指している。** ``TEST_DATABASE_URL`` の値が ``event_platform_billing`` になっていないか確認します。

ルート試験がネットワークや開発用データベースに触れたときは、:doc:`design` の差し替えが漏れた状態です。偽物を戻してから再実行します。署名試験で Stripe のクライアントが別の鍵を掴むときは、プロセス内のキャッシュより先に、その試験の鍵を固定します。

次に読む
--------

:doc:`ci`
