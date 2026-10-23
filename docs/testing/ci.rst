CI への接続
===========

読む順の 11 番です。前は :doc:`local-run` です。このページは、``.github/workflows/ci.yml`` が何をして、どこまでを約束するかを書きます。

置き場所
--------

ワークフローはリポジトリ直下の ``.github/workflows/ci.yml`` に 1 本だけ置きます。トリガーは ``pull_request`` と ``main`` への ``push`` です。同じブランチの実行が重なったときは、前の実行を打ち切ります（``concurrency`` の ``cancel-in-progress``）。

権限は ``contents: read`` と ``pull-requests: read`` です。後者は ``changes`` ジョブが PR の変更ファイル一覧を GitHub API から読むために要ります。CI からリポジトリへ書く操作はしません。

ジョブは 6 つです。先頭の ``changes`` が変更ファイルを見て、後続のジョブに走らせる範囲を渡します。

.. list-table::
   :header-rows: 1
   :widths: 12 30 58

   * - ジョブ
     - 呼ぶコマンド
     - 見ているもの
   * - ``changes``
     - ``gh api`` で PR の変更ファイル一覧を取る
     - ``code`` と ``flyer`` の 2 つの真偽値。規則は「変更に応じた絞り込み」に書きます
   * - ``check``
     - ``npm ci``（キャッシュヒット時は ``npx prisma generate``）のあと ``npm run check``
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

変更に応じた絞り込み
--------------------

``changes`` ジョブは PR の変更ファイル一覧を取り、次の規則で 2 つの真偽値を出します。``main`` への push は常に両方 ``true`` です。

.. list-table::
   :header-rows: 1
   :widths: 46 27 27

   * - 変更されたファイル
     - ``code``
     - ``flyer``
   * - ``docs/`` 配下、``llms.txt``、リポジトリ直下の ``.md``
     - false
     - false
   * - ``services/flyer/`` 配下
     - false
     - true
   * - ``.github/workflows/`` 配下
     - true
     - true
   * - それ以外（``src/``、``tests/``、``prisma/``、``scripts/``、依存の定義など）
     - true
     - false

``false`` のとき、そのジョブは重い step だけを飛ばします。``check`` と ``db`` は ``code`` が ``false`` なら何も走らせず、``flyer`` は ``flyer`` が ``false`` なら pytest まで進みません。``typecheck`` は必須チェックではないのでジョブごと飛ばします。``docs`` は絞りません。生成物の ``docs/traceability.md`` は、原稿が指すコードが実在するかで変わるためです。

判定は保守的にしてあります。判定を誤ると、触っていない領域の破壊を見逃します。次の 3 つは意図した安全側の振る舞いです。

* 一覧の取得に失敗したとき、または 0 件だったときは、全部 ``true`` に倒します。
* ``.github/workflows/`` を変えたときは、どのジョブが壊れたか分からないので全部走らせます。
* リポジトリ直下の ``.md`` は「文書だけ」に含めます。``AGENTS.md`` はテストの対象ではありません。

**必須チェックのジョブは消さず、step だけを飛ばします。** ``on.pull_request.paths`` で workflow ごと止めると、必須チェックが報告されないまま「待ち続けている」状態になり、いつまでもマージできなくなります。``if:`` でジョブごと飛ばした場合は skipped として報告されるため、必須チェックでの扱いが環境に依存します。必須の 3 つ（``check``、``db``、``flyer``）はジョブを走らせたまま step を飛ばして緑で完了させます。ジョブ名が変わらないので、ブランチ保護の設定もそのままです。

check ジョブ
------------

``npm ci`` の ``postinstall`` が ``prisma generate`` を呼ぶので、キャッシュミスのときは Prisma Client の生成を別ステップにしません。``node_modules`` は ``actions/cache`` で丸ごと戻します（鍵は ``package-lock.json`` と ``prisma/schema.prisma`` のハッシュ。``db`` ジョブと同じ鍵です）。ヒットしたときは ``npm ci`` を飛ばし、``postinstall`` が走らないぶんだけ ``npx prisma generate`` を明示的に呼びます。``setup-node`` の ``cache: npm`` は、ミスのときに ``npm ci`` がレジストリを叩かずに済むようにするためのものです。

``npm ci`` は 20 秒前後かかるので、鍵が合う間は展開済みの ``node_modules`` を戻したほうが速くなります。鍵に ``prisma/schema.prisma`` を混ぜているのは、生成済みの Prisma Client がスキーマに依存するためです。

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

apt での取得は 8 秒前後かかり、ミラーが遅い日はここで数分止まります。そこで ``FontResolver`` が実際に開く 2 本（``NotoSansCJK-Regular.ttc`` と ``NotoSerifCJK-Regular.ttc``）だけを ``actions/cache`` に控え、ヒットしたときは ``/usr/share/fonts/opentype/noto`` へ戻して ``fc-cache`` を流します。``FontResolver`` はファイルパスを直接開くので、fontconfig の設定そのものは使いません。鍵は ``noto-cjk-regular-1`` です。フォントの版を変えたらこの番号を上げます。

``pip`` のキャッシュは ``services/flyer/requirements.txt`` をキーにします。``working-directory`` を ``services/flyer`` にしてあるので、``pip install`` と ``pytest`` はそのまま書けます。

typecheck ジョブ
----------------

``services/flyer`` で ``python -m mypy`` を実行します。対象は ``mypy.ini`` の ``files = src`` です。``pytest`` と同じく ``requirements.txt`` を入れるのは、Pillow や Pydantic の型を解決するためです。

型検査と pytest は分けています。落ちたときに、振る舞いの失敗か型の失敗かがジョブ名で分かります。``flyer`` が ``false`` のときはジョブごと飛ばします。``services/flyer`` を触っていない PR で mypy を回しても、見るものがありません。

落とし穴
--------

* **``check`` は ``TEST_DATABASE_URL`` を渡していません。** DB を見る試験は ``db`` ジョブに分けています。``check`` を速いまま保つためで、``check`` が緑でも DB の試験は走っていません。
* ``npm ci`` は ``package-lock.json`` と ``package.json`` がずれていると落ちます。依存を足したら、lock も同じコミットに入れます。
* ``next lint`` は初回に ``.eslintrc.json`` を探します。設定ファイルを消したり移動したりすると、CI だけ落ちます。
* 索引は ``docs:gen`` の生成物です。原稿を足して再生成を忘れると、``docs`` ジョブの ``git diff --exit-code`` が落ちます。手元で ``npm run docs:gen`` を実行し、差分ごとコミットします。
* ``docs`` ジョブは Sphinx もビルドします。``docs/_build/`` は ``.gitignore`` にあるので、HTML は成果物として残しません。
* ``docs`` ジョブは依存を入れません。生成スクリプトは ``node:fs`` と ``node:path`` しか import しないため、``npm ci`` を省けます。新しいライブラリを生成スクリプトから使うときは、この前提が崩れるので ``npm ci`` を戻します。
* ``node_modules`` のキャッシュが壊れたと疑ったら、GitHub の Actions の Caches から鍵ごと消して再実行します。鍵は ``package-lock.json`` と ``prisma/schema.prisma`` のハッシュなので、依存かスキーマを変えれば自動的に外れます。
* フォントのキャッシュの鍵 ``noto-cjk-regular-1`` は固定です。``fonts-noto-cjk`` の版を上げたら番号も上げます。
* ``.venv-docs`` は復元したあとに ``import sphinx`` を試し、通らなければ捨てて作り直します。Python のパッチ版が上がると venv の中の絶対パスが古くなるためです。

db ジョブ
---------

``check`` とは別のジョブにしています。``check`` は 30 秒前後で終わる速い確認なので、PostgreSQL の起動待ちを混ぜません。

.. code-block:: yaml

   db:
     runs-on: ubuntu-latest
     services:
       postgres:
         image: postgres:16-alpine
         env:
           POSTGRES_USER: postgres
           POSTGRES_PASSWORD: postgres
           POSTGRES_DB: event_platform_billing_test
         ports:
           - 5432:5432
         options: >-
           --health-cmd pg_isready
           --health-interval 5s
           --health-timeout 5s
           --health-retries 10
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with:
           node-version: 24
           cache: npm
       # check ジョブと同じ鍵。npm ci の 20 秒を避ける。
       - uses: actions/cache@v4
         with:
           path: node_modules
           key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json', 'prisma/schema.prisma') }}
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

``alpine`` 版はイメージが小さく、コンテナの初期化（``Initialize containers``）が数秒短くなります。healthcheck の間隔は 5 秒にしてあります。``npm ci`` の 20 秒を避けるため、``node_modules`` は ``check`` ジョブと同じ鍵で戻します。

``services`` の ``options`` に ``pg_isready`` の healthcheck を付けます。これが無いと、PostgreSQL が接続を受け付ける前に ``prisma migrate deploy`` が走って落ちます。

``TEST_DATABASE_URL`` と ``DATABASE_URL`` には同じ値を入れます。片方だけだと ``tests/setup/db.ts`` が差し替えず、開発用の接続先を見に行きます。

スキーマは ``prisma db push`` ではなく ``prisma migrate deploy`` で作ります。``db push`` は Prisma スキーマに書けない制約を作りません。部分ユニーク索引 ``event_organizers_one_owner`` と、``phone_verification_codes`` などの ``CHECK`` 制約がこれにあたります。``db push`` で作った DB では ``tests/integration/hydrate.test.ts`` の「1 イベントに OWNER を 2 行は作れない」が落ちます。

``npm run test:e2e`` を足すときは、``npm run build`` のあと Playwright を呼びます。行程はローカル登録と、アカウントなしの出欠の二本です。

マージ前のゲートにする
----------------------

GitHub のブランチ保護で ``check``、``db``、``flyer`` の 3 つを必須にしています（2026-10-22 に設定）。``docs`` と ``typecheck`` ジョブは同じ日に足しましたが、必須への登録は別操作なので、まだ保護には入っていません。落ちたままの ``main`` が防げ、触っていない領域の破壊（とくに ``services/flyer``）を検出できます。

必須にするのは、そのリポジトリで実際に走ったことのあるジョブ名だけです。``db`` を足す前は ``check`` と ``flyer`` の 2 つでした。**ジョブ名を変えると必須チェックは「待ち続けている」状態になり、いつまでもマージできなくなります。** 名前を変えるときは、同じ PR でブランチ保護も直します。

変更に応じた絞り込みを入れても、必須チェックの名前と数は変わりません。飛ぶのは step だけで、ジョブは緑で完了します。ただし判定を誤ると、触っていない領域の破壊を見逃します。``services/flyer`` を含む PR では ``flyer`` が必ず走る、という規則は崩さないでください。

``strict`` を有効にしてあるので、``main`` が進んだらブランチを最新化してから再実行します。

``enforce_admins`` は無効です。管理者は赤いままでもマージできます。個人開発で自分を締め出さないための設定ですが、ゲートとして効くのは **自分がそのゲートに従ったときだけ** です。

この節の先頭
------------

読む順は :doc:`index` に戻ります。実装を始めるときは :doc:`scope` の「これから書くテスト」から入ります。
