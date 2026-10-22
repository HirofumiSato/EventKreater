CI への接続
===========

読む順の 11 番です。前は :doc:`local-run` です。このページは、``.github/workflows/ci.yml`` が何をして、どこまでを約束するかを書きます。

置き場所
--------

ワークフローはリポジトリ直下の ``.github/workflows/ci.yml`` に 1 本だけ置きます。トリガーは ``pull_request`` と ``main`` への ``push`` です。同じブランチの実行が重なったときは、前の実行を打ち切ります（``concurrency`` の ``cancel-in-progress``）。

権限は ``contents: read`` だけです。CI からリポジトリへ書く操作はしません。

ジョブは 5 つです。

.. list-table::
   :header-rows: 1
   :widths: 12 26 62

   * - ジョブ
     - 呼ぶコマンド
     - 見ているもの
   * - ``check``
     - ``npm ci`` のあと ``npm run check``
     - ESLint、``tsc --noEmit``、``tests/unit/`` の 289 件
   * - ``db``
     - ``npm ci``、``prisma migrate deploy``、``npm run test:db``
     - ``tests/integration/`` の 59 件。テスト専用の PostgreSQL をサービスとして立てる
   * - ``flyer``
     - ``pip install -r requirements.txt`` のあと ``python -m pytest -q``
     - ``services/flyer/tests/`` の描画・API・候補の試験
   * - ``docs``
     - ``npm run docs:gen``、``git diff --exit-code``、``npm run docs:links``、``npm run docs``
     - 索引 4 点が最新か、原稿のパスが実在するか、Sphinx が HTML を生成できるか
   * - ``typecheck``
     - ``pip install -r requirements.txt`` のあと ``python -m mypy``
     - ``services/flyer/src`` の型。``mypy.ini`` の strict 設定

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

``tests/setup/db.ts`` は ``TEST_DATABASE_URL`` があるときだけ ``DATABASE_URL`` を差し替えます。``check`` は ``TEST_DATABASE_URL`` を渡さないので、``tests/integration/`` の 59 件は skip され、DB へは接続しません。``DATABASE_URL`` は Prisma Client の生成が参照するだけです。

Stripe の秘密鍵、Webhook の署名鍵、Google のクライアント、OpenAI のキーは要りません。ジョブの秘密として登録する必要もありません。署名の試験は、テスト内のダミー鍵で完結します。

flyer ジョブ
------------

描画の試験は日本語フォントを読みます。``FontResolver.path_for`` は候補を順に見て、どれも開けなければ ``FontRenderError`` を投げます。Ubuntu のランナーには日本語フォントが入っていないので、``fonts-noto-cjk`` を apt で入れます。これを忘れると、手元では通るのに CI だけ落ちます。

``pip`` のキャッシュは ``services/flyer/requirements.txt`` をキーにします。``working-directory`` を ``services/flyer`` にしてあるので、``pip install`` と ``pytest`` はそのまま書けます。

typecheck ジョブ
----------------

``services/flyer`` で ``python -m mypy`` を実行します。対象は ``mypy.ini`` の ``files = src`` です。``pytest`` と同じく ``requirements.txt`` を入れるのは、Pillow や Pydantic の型を解決するためです。

型検査と pytest は分けています。落ちたときに、振る舞いの失敗か型の失敗かがジョブ名で分かります。

落とし穴
--------

* **``check`` は ``TEST_DATABASE_URL`` を渡していません。** DB を見る試験は ``db`` ジョブに分けています。``check`` を速いまま保つためで、``check`` が緑でも DB の試験は走っていません。
* ``npm ci`` は ``package-lock.json`` と ``package.json`` がずれていると落ちます。依存を足したら、lock も同じコミットに入れます。
* ``next lint`` は初回に ``.eslintrc.json`` を探します。設定ファイルを消したり移動したりすると、CI だけ落ちます。
* 索引は ``docs:gen`` の生成物です。原稿を足して再生成を忘れると、``docs`` ジョブの ``git diff --exit-code`` が落ちます。手元で ``npm run docs:gen`` を実行し、差分ごとコミットします。
* ``docs`` ジョブは Sphinx もビルドします。``docs/_build/`` は ``.gitignore`` にあるので、HTML は成果物として残しません。

db ジョブ
---------

``check`` とは別のジョブにしています。``check`` は 30 秒前後で終わる速い確認なので、PostgreSQL の起動待ちを混ぜません。

.. code-block:: yaml

   db:
     runs-on: ubuntu-latest
     services:
       postgres:
         image: postgres:16
         env:
           POSTGRES_USER: postgres
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
       - run: npx prisma migrate deploy
         env:
           DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/event_platform_billing_test
       - run: npm run test:db
         env:
           DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/event_platform_billing_test
           TEST_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/event_platform_billing_test
           JWT_SECRET: ci-only-placeholder-secret-value-not-used
           NEXT_PUBLIC_APP_URL: http://localhost:3012

``services`` の ``options`` に ``pg_isready`` の healthcheck を付けます。これが無いと、PostgreSQL が接続を受け付ける前に ``prisma migrate deploy`` が走って落ちます。

``TEST_DATABASE_URL`` と ``DATABASE_URL`` には同じ値を入れます。片方だけだと ``tests/setup/db.ts`` が差し替えず、開発用の接続先を見に行きます。

スキーマは ``prisma db push`` ではなく ``prisma migrate deploy`` で作ります。``db push`` は Prisma スキーマに書けない制約を作りません。部分ユニーク索引 ``event_organizers_one_owner`` と、``phone_verification_codes`` などの ``CHECK`` 制約がこれにあたります。``db push`` で作った DB では ``tests/integration/hydrate.test.ts`` の「1 イベントに OWNER を 2 行は作れない」が落ちます。

``npm run test:e2e`` を足すときは、``npm run build`` のあと Playwright を呼びます。行程はローカル登録と、アカウントなしの出欠の二本です。

マージ前のゲートにする
----------------------

GitHub のブランチ保護で ``check``、``db``、``flyer`` の 3 つを必須にしています（2026-10-22 に設定）。``docs`` と ``typecheck`` ジョブは同じ日に足しましたが、必須への登録は別操作なので、まだ保護には入っていません。落ちたままの ``main`` が防げ、触っていない領域の破壊（とくに ``services/flyer``）を検出できます。

必須にするのは、そのリポジトリで実際に走ったことのあるジョブ名だけです。``db`` を足す前は ``check`` と ``flyer`` の 2 つでした。**ジョブ名を変えると必須チェックは「待ち続けている」状態になり、いつまでもマージできなくなります。** 名前を変えるときは、同じ PR でブランチ保護も直します。

``strict`` を有効にしてあるので、``main`` が進んだらブランチを最新化してから再実行します。

``enforce_admins`` は無効です。管理者は赤いままでもマージできます。個人開発で自分を締め出さないための設定ですが、ゲートとして効くのは **自分がそのゲートに従ったときだけ** です。

この節の先頭
------------

読む順は :doc:`index` に戻ります。実装を始めるときは :doc:`scope` の「これから書くテスト」から入ります。
