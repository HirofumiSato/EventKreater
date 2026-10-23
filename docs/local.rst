ローカルでの操作
================

前提
----

手元で動かすために、次を用意します。

* Node.js 24
* npm
* PostgreSQL 14 以降（ローカルの ``localhost:5432``）
* Python 3.11 以降（このドキュメントのビルドに使う）
* Stripe のテストモード用 API キー（決済を試す場合）
* Stripe CLI（Webhook をローカルに転送する場合。任意）

コマンドはリポジトリ直下で実行します。Node の版はリポジトリ直下の ``.nvmrc``（24）に合わせます。``nvm use`` か ``fnm use`` で切り替わり、``package.json`` の ``engines.node`` が下限を宣言しています。

初回セットアップ
----------------

依存パッケージを入れます。 ``postinstall`` で ``prisma generate`` が走り、Prisma Client が生成されます。

.. code-block:: powershell

   npm install

``.env.example`` を ``.env`` にコピーし、値を手元の環境に合わせます。
``.env`` は Git に含めません。

.. code-block:: powershell

   Copy-Item .env.example .env

環境変数
--------

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - 名前
     - 役割
   * - ``DATABASE_URL``
     - Prisma が接続する PostgreSQL。データベース名は ``event_platform_billing``
   * - ``JWT_SECRET``
     - ログイン Cookie の署名鍵。32 文字以上。短いと認証 API が失敗する
   * - ``STRIPE_SECRET_KEY``
     - テストモードの秘密鍵（ ``sk_test_`` で始まる）
   * - ``STRIPE_WEBHOOK_SECRET``
     - Webhook 署名検証用（ ``whsec_`` で始まる）。Stripe CLI の表示値を入れる
   * - ``STRIPE_PRICE_ID_MONTHLY_980``
     - 月額 980 円プランの Price ID（ ``price_`` で始まる）。テストモードで作る
   * - ``STRIPE_PRICE_ID_ONE_TIME``
     - 任意。単発 299 円の Price ID。空なら Checkout が 299 円の ``price_data`` を作る
   * - ``NEXT_PUBLIC_APP_URL``
     - Checkout の戻り先と Customer Portal の戻り先。起動しているオリジンと一致させる
   * - ``MAIL_WEBHOOK_URL``
     - 確認メールの配送先。空なら送信記録だけを残す
   * - ``SMS_WEBHOOK_URL``
     - 電話番号確認コードとログイン確認番号のSMS配送先。空ならサーバログに本文を残す
   * - ``GOOGLE_CLIENT_ID`` / ``GOOGLE_CLIENT_SECRET``
     - Google サインイン。空なら登録画面で設定不足と表示する

``.env.example`` ではアプリ URL を ``http://localhost:3012`` にしています。
``next dev`` の既定ポートは 3000 なので、どちらかに揃えます。

* 例の URL に合わせる場合は ``npm run dev`` です。Web は 3012、チラシ API も 8000 で起動します
* ポート 3000 で起動する場合は、 ``NEXT_PUBLIC_APP_URL`` を ``http://localhost:3000`` にする

未設定のとき、Checkout のベース URL は ``http://localhost:3000`` にフォールバックします（ ``src/lib/http.ts`` の ``appBaseUrl`` ）。
Stripe の鍵、テストカード、Webhook の注意は :doc:`stripe` です。 ``sk_live_`` は置きません。

データベースを作ってからマイグレーションします。手順の詳細は :doc:`database` を参照してください。

.. code-block:: powershell

   npm run db:migrate

初期のアカウントは ``npm run db:seed`` で作ります。既にあるときはパスワード、権限、確認済み状態を上書きします。メール確認と電話番号確認は済んだ状態で入ります。

.. list-table::
   :header-rows: 1
   :widths: 22 26 26 26

   * - 種別
     - メール
     - パスワード
     - ログイン画面
   * - 主催者（ ``MEMBER`` ）
     - ``organizer@example.com``
     - ``Testpass123!``
     - ``/auth/register`` のログイン
   * - 管理者（ ``ADMIN`` ）
     - ``admin@example.com``
     - ``Adminpass123!``
     - ``/console/login``

パスワードが通ったあと、確認番号が要ります。 ``SMS_WEBHOOK_URL`` と ``MAIL_WEBHOOK_URL`` が空なら、開発サーバーのログに ``[sms]`` または ``[mail]`` で 6 桁が出ます。

確認番号を通したあとの着地は ``next`` で決まります。会員登録・ログイン画面（ ``/auth/register`` ）を使えるのは会員だけです。

* ``next`` を指定していない会員は ``/mypage`` （マイページ）へ移動します
* ``next`` を指定した会員は、そのパスへ移動します
* 管理者は ``/auth/register`` から入れません。着地は常に ``/console`` （管理者ホーム）で、入口は ``/console/login`` だけです

``next`` に使えるのは ``/mypage`` 、 ``/organizer`` 、 ``/invitations`` 、 ``/events`` の配下だけです。電話番号が未確認のまま主催画面を使おうとしたときは ``next=/organizer/events`` または ``next=/organizer/events/new`` が付きます。

別の会員を管理者にする場合は ``npm run admin:promote -- user@example.com`` です。管理者ログインには、確認済みの電話番号とパスワードを持つ会員であることが要ります。

管理者は ``/console/login`` からだけ入れます。 ``/auth/register`` のログインや Google ログインで管理者の資格情報を入れても、確認番号は発行されず「管理者アカウントは /console/login からのみログインできます。」と出ます。

開発サーバー
------------

``.env.example`` の URL に合わせる起動です。チラシ API（8000）と Web（3012）を同時に立ち上げます。

.. code-block:: powershell

   npm run dev

ブラウザで http://localhost:3012 を開きます。

Web だけを起動するときは ``npm run dev:web`` です。ポートを 3000 にする場合は ``NEXT_PUBLIC_APP_URL`` を ``http://localhost:3000`` にしてください。

``dev:web`` は Turbopack（ ``next dev --turbo`` ）で起動します。手元の実測では、初回のコンパイルが ``/`` で 6 秒、``/service`` で 1.3 秒です。同じ 5 画面を開くのに Webpack は 18.7 秒、Turbopack は 12.4 秒でした。保存から再描画までの待ちは、この差より大きく開きます。

Next.js 14.2 の Turbopack は beta です。画面が崩れる、コンパイルが通らない、といった症状が出たら ``npm run dev:web:webpack`` で Webpack に戻して切り分けます。

``JWT_SECRET`` や ``DATABASE_URL`` を変えたあとは、開発サーバーを止めて再起動します。

Docker で動かす
~~~~~~~~~~~~~~~

Node・Python・PostgreSQL をホストに入れずに起動できます。初回だけ ``migrate`` を回します。

.. code-block:: powershell

   docker compose build
   docker compose --profile setup run --rm migrate
   docker compose up

``db``（5433）・``flyer``（8000）・``web``（3012）が起動します。``migrate`` は profile ``setup`` なので ``up`` では動きません。初回とスキーマ変更時だけ実行してください。

.. warning::

   ホスト側と Docker 側は、DB もポートも別です。ホストは ``localhost:5432`` の PostgreSQL と ``npm run dev`` 、Docker は ``localhost:5433`` と ``docker compose up`` です。両方を同時に立ち上げると、``npm run dev`` が 8000 番をコンテナのチラシ API に取られて、どちらを見ているのか分からなくなります。メモリも二重に食います。

   手元で速く回すときは、ホスト側だけにしてください。Docker は本番相当の確認と、ホストに Node・Python・PostgreSQL を入れたくない場合に使います。Docker を止めるときは ``docker compose down`` です。ボリュームは残るので、DB とチラシ画像は消えません（消えるのは ``docker compose down -v`` です）。

.. list-table::
   :header-rows: 1
   :widths: 28 72

   * - 項目
     - 内容
   * - ``DATABASE_URL``
     - コンテナ内は ``postgres:postgres@db:5432`` を使います。``.env`` の ``localhost:5432`` は使いません。ホストからは ``localhost:5433`` で繋がります
   * - ``FLYER_API_URL``
     - ``http://flyer:8000`` に上書きされます。``.env`` の ``127.0.0.1:8000`` はコンテナ自身を指すためです
   * - ``node_modules`` / ``.next``
     - 名前付きボリュームに置きます。ホストの Windows 版バイナリを混ぜないためです。``package.json`` を変えたら ``docker compose exec web npm install`` を実行します
   * - 本番相当
     - ``docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build`` 。standalone ビルドを ``node server.js`` で起動し、ソースの bind mount を外します
   * - データの削除
     - ``docker compose down -v`` は DB とチラシ画像のボリュームも消します

イメージは Node 24 と Python 3.12 です。チラシの描画に要る日本語フォント（ ``fonts-noto-cjk`` ）は flyer イメージに入れてあります。

画面の確認
----------

見た目、Stripe の実画面、Google サインインは、この節で人が確認します。自動で確かめる範囲と読む順は :doc:`/testing/index` にあります。

.. list-table::
   :header-rows: 1
   :widths: 42 58

   * - パス
     - 内容
   * - ``/``
     - トップ。ヘッダーのサービス名は ``EventKreater``（ ``src/lib/site.ts`` の ``SITE.name`` ）。未ログイン時のボタンは「主催者ログイン」（ ``SITE.nav.organizerLogin`` ）。サービス紹介と使い方、サービスと料金へのリンク。イベントの一覧・検索は無い
   * - ``/service``
     - サービスと料金。無料2回、単発299円、月額980円。キャンペーン中は販売価格と定価を併記する。支払いボタンは無い
   * - ``/terms``
     - 利用規約。料金、自動更新、無料期間の終了前通知、解約、返金
   * - ``/auth/register``
     - 会員登録とログイン。パスワード登録は確認メールのあと電話番号を確認し、成功すると ``/mypage`` へ移動する
   * - ``/auth/register?step=login-code``
     - ログイン確認番号。既定は登録済み電話へのSMS。SMSが届かないときはメール。コードは Webhook が空ならサーバログに出る
   * - ``/auth/register?step=phone``
     - 電話番号の確認。確認コードは ``SMS_WEBHOOK_URL`` が空ならサーバログに出る
   * - ``/auth/verify``
     - 確認メールのリンク先。成功後は電話番号確認へ進む
   * - ``/mypage``
     - 利用枠、主催イベント、参加した出欠
   * - ``/organizer/events``
     - 主催イベント一覧。冒頭見出しは画面名
   * - ``/organizer/events/new``
     - 新規イベント作成。公開状態は公開中で保存する。枠が無いと料金モーダルが出る。冒頭見出しは画面名
   * - ``/organizer/events/{id}``
     - 編集へリダイレクトする
   * - ``/organizer/events/{id}/edit``
     - イベント編集。排他ロックは期限なし。保持者本人には排他の表示を出さない。催し名はリード
   * - ``/organizer/events/{id}/participants``
     - 参加者名簿。催し名はリード
   * - ``/organizer/events/{id}/receipts/{participantId}``
     - 幹事向け領収書。印刷しない見出しが画面名
   * - ``/invitations/{code}``
     - 共同幹事受諾。催し名はリード
   * - ``/events/{id}``
     - 公開ページと出欠
   * - ``/console/login``
     - 管理者ログイン。パスワードのあと確認番号。確認済み電話が必須。公開ナビには出さない。冒頭見出しは画面名
   * - ``/console``
     - 管理者ホーム。会員、イベント、決済への入口
   * - ``/console/users``
     - 会員検索・権限変更
   * - ``/console/events``
     - イベント検索。下書きと削除済みを含む
   * - ``/console/payments``
     - 利用枠の決済履歴。返金操作はしない
   * - ``/console/pricing``
     - 価格キャンペーン。作成、編集、停止。``0 0 * * *`` などの日次で通知バッチを叩く

会員登録では名前、メールアドレス、8 文字以上のパスワードを送ります。
同じメールでも、登録 API の応答文は変えません。会員行と利用枠は、電話番号の確認が終わるまで作りません。
確認済みの電話番号が既にあるときは、新しい行は作らず、その会員へメールまたは Google を足します。無料枠は増えません。

パスワードまたは Google が通っただけではログインしません。確認番号の照合が成功してから Cookie ``auth_token`` が付き、有効期限は 7 日です。電話未確認の会員が無料枠だけを使う公開は HTTP 403 です。

利用枠の動き
------------

イベント作成時の判定は ``src/modules/billing/lib/quota.ts`` にあります。優先順は次のとおりです。

1. ``subscription_status`` が ``PAST_DUE`` なら作成できない
2. ``ACTIVE`` かつ ``current_period_end`` が現在より未来なら、枠を消費せず作成できる
3. ``paid_credits`` が 1 以上なら 1 減らして作成する
4. ``free_event_count`` が 2 未満で、電話番号が確認済みなら 1 増やして作成する（無料は 2 回まで）
5. 無料枠は残っているが電話番号が未確認なら HTTP 403
6. どれも使えなければ HTTP 402

料金は単発 299 円、月額 980 円です。単発は Checkout の ``price_data`` で金額を指定します。月額は Stripe 上の Price ID を ``STRIPE_PRICE_ID_MONTHLY_980`` から読みます。

販売価格は ``/console/pricing`` の期間キャンペーンで変わります。単発が 0 円のときは Stripe を通さず、確認済み電話番号の会員へその場で 1 回分を付与します。月額が 0 円のときは 100% off の繰り返しクーポンを付け、カード登録を必須にします。無料期間が終わると定価で自動請求します。終了の 3 日前と 1 日前のメールは ``npm run billing:notices``、または ``POST /api/v1/internal/billing/notices`` を日次で叩いて送ります。``BILLING_NOTICE_SECRET`` が要ります。

npm scripts
-----------

.. list-table::
   :header-rows: 1
   :widths: 28 72

   * - コマンド
     - 内容
   * - ``npm run dev``
     - チラシ API（8000）と Web（3012）を起動する。Web は Turbopack
   * - ``npm run dev:web``
     - Next.js だけをポート 3012 で起動する。Turbopack
   * - ``npm run dev:web:webpack``
     - Next.js だけをポート 3012 で起動する。Webpack。Turbopack で問題が出たときの退避先
   * - ``npm run build``
     - 本番ビルド
   * - ``npm start``
     - ``next build`` 済みのアプリを起動
   * - ``npm run lint``
     - ESLint
   * - ``npm run check``
     - ESLint・``tsc --noEmit``・Vitest を並列で走らせ、全部の結果をまとめて出す。1 つでも落ちれば終了コード 1
   * - ``npm run check:serial``
     - 同じ 3 つを順に走らせる。並列で落ちたときに、単体で再現させるため
   * - ``npm run db:migrate``
     - ``prisma migrate dev``
   * - ``npm run db:seed``
     - ローカルの主催者と管理者を作る
   * - ``npm run db:studio``
     - Prisma Studio
   * - ``npm run docs:install``
     - ドキュメント用の Python 仮想環境を作り Sphinx を入れる
   * - ``npm run docs``
     - HTML ドキュメントをビルドする

Stripe をローカルで試す
-----------------------

テストモードの鍵、テストカード、Webhook、課金と返金の境界は :doc:`stripe` にまとめています。
``STRIPE_SECRET_KEY`` は ``sk_test_`` だけを置きます。 ``/console/payments`` から返金はしません。

要点だけ次です。

* Dashboard はテストデータ側にする。月額 980 円（JPY、月次）の Price ID を ``STRIPE_PRICE_ID_MONTHLY_980`` に入れる
* テストカードは ``4242 4242 4242 4242``
* 付与経路は Checkout 戻り先の ``POST /api/v1/billing/checkout/verify`` と、Webhook の ``POST /api/v1/webhooks/stripe`` の 2 つ
* CLI の転送先ポートは ``NEXT_PUBLIC_APP_URL`` に合わせる。``.env.example`` なら 3012

.. code-block:: powershell

   stripe listen --forward-to localhost:3012/api/v1/webhooks/stripe
