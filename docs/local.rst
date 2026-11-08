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
   * - ``STRIPE_PRICE_ID_MONTHLY_8``
     - 8件まで公開プラン 980 円の Price ID（ ``price_`` で始まる）。テストモードで作る
   * - ``STRIPE_PRICE_ID_UNLIMITED``
     - 公開し放題プラン 2,980 円の Price ID（ ``price_`` で始まる）。テストモードで作る
   * - ``STRIPE_PRICE_ID_MONTHLY_980_LEGACY``
     - 任意。値上げ前に加入した 980 円の公開し放題プランの Price ID。既存契約の検証だけに使う。名前を変える前の ``STRIPE_PRICE_ID_MONTHLY_980`` も同じ用途で読みます
   * - ``STRIPE_PRICE_ID_ONE_TIME``
     - 任意。単発 299 円の Price ID。空なら Checkout が 299 円の ``price_data`` を作る
   * - ``NEXT_PUBLIC_APP_URL``
     - Checkout の戻り先と Customer Portal の戻り先。起動しているオリジンと一致させる
   * - ``MAIL_WEBHOOK_URL``
     - 確認メールの配送先。空なら送信記録だけを残す
   * - ``SMS_WEBHOOK_URL``
     - 電話番号確認コードとログイン確認番号のSMS配送先。空ならサーバログに本文を残す
   * - ``GOOGLE_CLIENT_ID`` / ``GOOGLE_CLIENT_SECRET``
     - Google サインイン。空なら登録画面で設定不足と表示する。Google ログインの入口は当面画面に出していないが、 ``GET /api/v1/auth/google`` とコールバックは残すので、値は入れておく
   * - ``OPENAI_API_KEY``
     - イベント作成画面の音声入力（音声認識）。空ならマイクボタンは使えず、手入力に戻る
   * - ``VOICE_TRANSCRIBE_MODEL``
     - 任意。音声認識のモデル。空なら ``gpt-transcribe``
   * - ``VOICE_TRANSCRIBE_FALLBACK_MODEL``
     - 任意。モデルが使えない（400/404）ときに 1 度だけ試す控え。空なら ``gpt-4o-mini-transcribe``
   * - ``VOICE_BATCH_MODEL``
     - 任意。まとめて話すときの割当に使う LLM。空なら ``gpt-4.1-mini``
   * - ``VOICE_BATCH_LLM``
     - 任意。``0`` ならまとめて話すときの LLM を使わず、決定的な割当だけにする
   * - ``VOICE_TRANSCRIBE_LIMIT`` / ``VOICE_TRANSCRIBE_WINDOW_MINUTES``
     - 任意。接続元ごとの音声認識の回数と、数える窓（分）。既定は 1 時間 40 回。まとめて話すときも 1 回で 1 と数える
   * - ``VOICE_TRANSCRIBE_MOCK``
     - 任意。``1`` なら録音と OpenAI の呼び出しを省き、欄の入力例をその場で入れる（開発用）。マイクの無い PC でも自動遷移を確かめられる。``NODE_ENV=production`` では無効

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

同じとき、確認番号の画面にも「開発用の確認番号は …… です。」と出ます。 ``NODE_ENV=production`` では出さず、 ``AUTH_DEV_CODE=0`` でも消せます。画面に出るのは、配送が記録に留まった（Webhook が空だった）ときだけです。

確認番号を通したあとの着地は ``next`` で決まります。会員登録・ログイン画面（ ``/auth/register`` ）を使えるのは会員だけです。

* ``next`` を指定していない会員は ``/mypage`` （マイページ）へ移動します
* ``next`` を指定した会員は、そのパスへ移動します
* 管理者は ``/auth/register`` から入れません。着地は常に ``/console`` （管理者ホーム）で、入口は ``/console/login`` だけです

``next`` に使えるのは ``/mypage`` 、 ``/organizer`` 、 ``/invitations`` 、 ``/events`` 、 ``/participant`` 、 ``/organizers`` の配下だけです。電話番号が未確認のまま主催画面を使おうとしたときは ``next=/organizer/events`` または ``next=/organizer/events/new`` が付きます。

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

Turbopack と Webpack は ``.next`` の作りが違います。片方で作った ``.next`` のまま、もう片方で起動すると、
``Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`` （ ``.next/server/pages/_document.js`` を読み込むとき）で
500 になります。起動方式を変えるときは、開発サーバーを止めて ``.next`` を消してから起動し直します。

.. code-block:: powershell

   Remove-Item -Recurse -Force .next
   npm run dev:web

起動中のサーバーを残したまま ``npm run build`` を回しても、同じ食い違いが起きます。ビルドは開発サーバーを止めてから行います。

``JWT_SECRET`` や ``DATABASE_URL`` を変えたあとは、開発サーバーを止めて再起動します。

保存した直後や git の操作のあとに、どの URL も 500 になることがあります（ ``npm run dev`` で起動した場合のみ自動で戻ります）
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Windows の作業ツリー（このリポジトリは OneDrive の下にあります）では、保存した直後のファイルを
OneDrive やエディタが短く掴むことがあります。その瞬間に Tailwind が ``src/**/*.tsx`` を読み直すと、
``EBUSY: resource busy or locked`` で ``globals.css`` のビルドが落ちます。Turbopack はその失敗を覚えたままなので、
以後どの URL も 500 を返し続け、ファイルを触り直しても直りません（再起動だけが効きます）。

もう 1 つ、 ``.next`` の作りだけが古く残る失敗があります。枝の切り替えやマージのあとに、
Turbopack が覚えている解決の表がディスクと食い違い、あるはずのファイルを
``Module not found: Can't resolve '@/modules/events/lib/summary'`` と言い続けます。
こちらは再起動だけでは直らず、 ``.next`` を消す必要があります。

``npm run dev`` は、次の 3 つを見分けて ``next dev`` を立て直します。

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - 見つける失敗
     - 動き
   * - ``EBUSY`` ・ ``Failed to read source code`` ・ ``os error 32``
     - 2.5 秒待ってから起動し直す（掴んでいた側が離れてから戻る）
   * - ``Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`` ・
       ``Cannot read properties of null (reading 'useContext')``
     - ``.next`` を消してから起動し直す（作り直しに 30 秒ほどかかる）
   * - ``Module not found`` の import 先が、ディスクには**ある**
     - ``.next`` を消してから起動し直す。無いときは本当の誤りなので、再起動せずエラーをそのまま出す

``.next`` を消しての立て直しは 1 回の起動につき 2 回までにします。3 回目は
「 ``npm run dev:clean`` で起動し直してください」と案内して止まります（作り直しを繰り返すと、
そのたびに 30 秒待たされるため）。手でやり直すときは ``npm run dev:clean`` です。

.. code-block:: powershell

   npm run dev:clean

``npm run dev:web`` を単体で起動したときは、この見張りがありません。500 が続くときは止めて
``npm run dev:clean`` で起動し直します。原因が手元のコードにある失敗（構文エラーなど）では、
再起動はせず、そのままエラーを出します。

``.next`` を消すと、git の管理外にあるビルドキャッシュも消えます。消してよいものだけが入っており、
次に開いた画面から作り直されます（初回のコンパイルに数秒かかります）。

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
   * - ``docs/flyer/specs``
     - flyer コンテナへ ``/repo/docs/flyer/specs`` として読み取り専用で渡します。``docker compose exec flyer python -m pytest`` で、仕様書とプロンプトの一致まで含めて全件が走ります
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
     - サービスと料金。無料チケット2枚、単発299円、8件まで公開プラン980円、公開し放題プラン2980円。キャンペーン中は販売価格と定価を併記する。支払いボタンは無い
   * - ``/terms``
     - 利用規約。料金、自動更新、無料期間の終了前通知、解約、返金
   * - ``/auth/register``
     - 会員登録とログイン。パスワード登録は確認メールのあと電話番号を確認し、成功すると ``/mypage`` へ移動する
   * - ``/auth/register?step=login-code``
     - ログイン確認番号。一般会員の既定はメール、管理者の入口は SMS。SMS はチャネルの切り替えで選べる。コードは Webhook が空ならサーバログと画面に出る（本番は出さない）
   * - ``/auth/register?step=phone``
     - 電話番号の確認。確認コードは ``SMS_WEBHOOK_URL`` が空ならサーバログに出る
   * - ``/auth/verify``
     - 確認メールのリンク先。成功後は電話番号確認へ進む
   * - ``/mypage``
     - チケット、主催イベント、参加した出欠
   * - ``/organizer/events``
     - 主催イベント一覧。冒頭見出しは画面名
   * - ``/organizer/events/new``
     - 新規イベント作成。公開状態は公開中で保存する。チケットが無いと料金モーダルが出る。冒頭見出しは画面名
   * - ``/organizer/events/{id}``
     - 編集へリダイレクトする
   * - ``/organizer/events/{id}/edit``
     - イベント編集。排他ロックは期限なし。保持者本人には排他の表示を出さない。催し名はリード
   * - ``/organizer/events/{id}/participants``
     - 参加者名簿。見出しは催し名にし、上に小さく「参加者名簿」を置く。行を開いて出欠・人数・集金を直す。リマインドは持たない
   * - ``/invitations/{code}``
     - 共同幹事受諾。催し名はリード
   * - ``/events/{id}``
     - 公開ページと出欠
   * - ``/organizers/{userId}``
     - 主催者のページ。プロフィールの下にカレンダーと一覧を縦に並べる。催しは参加者ログインが必要。旧 ``/organizers/{userId}/events`` はここへ転送する
   * - ``/console/login``
     - 管理者ログイン。パスワードのあと確認番号。確認済み電話が必須。公開ナビには出さない。冒頭見出しは画面名
   * - ``/console``
     - 管理者ホーム。会員、イベント、決済への入口
   * - ``/console/users``
     - 会員検索・権限変更
   * - ``/console/events``
     - イベント検索。下書きと削除済みを含む
   * - ``/console/payments``
     - チケットの決済履歴。返金操作はしない
   * - ``/console/pricing``
     - 価格キャンペーン。作成、編集、停止。``0 0 * * *`` などの日次で通知バッチを叩く

会員登録では名前、メールアドレス、8 文字以上のパスワードを送ります。
同じメールでも、登録 API の応答文は変えません。会員行とチケット情報は、電話番号の確認が終わるまで作りません。
確認済みの電話番号が既にあるときは、新しい行は作らず、その会員へメールまたは Google を足します。無料チケットは増えません。

パスワードまたは Google が通っただけではログインしません。確認番号の照合が成功してから Cookie ``auth_token`` が付き、有効期限は 7 日です。電話未確認の会員が無料チケットだけを使う公開は HTTP 403 です。

チケットの動き
--------------

イベント作成時の判定は ``src/modules/billing/lib/quota.ts`` にあります。優先順は次のとおりです。

1. ``subscription_status`` が ``PAST_DUE`` なら作成できない
2. ``ACTIVE`` かつ ``current_period_end`` が現在より未来なら、加入した階層で決める

   * 公開し放題プラン（ ``UNLIMITED`` ）は公開中のイベント数を数えない
   * 8件まで公開プラン（ ``MONTHLY_8`` ）は、公開中のイベントが 8 件未満なら通す。8 件に達していれば単発クレジットへ進み、無ければ HTTP 402（ ``PUBLISHED_EVENTS_FULL`` ）
3. ``paid_credits`` が 1 以上なら 1 減らして作成する
4. 2 と 3 が使えず、加入していないなら、 ``free_event_count`` が 2 未満かつ電話番号が確認済みなら 1 増やして作成する（無料チケットは 2 枚まで）
5. 無料チケットは残っているが電話番号が未確認なら HTTP 403
6. どれも使えなければ HTTP 402

「公開中のイベント」は、 ``status = PUBLISHED`` で、削除されておらず、開催日が今日（JST）以降のものです。開催日を過ぎたもの、公開を一時停止（ ``CLOSED`` ）したもの、削除したものは数えません。 ``events.quota_source`` が ``SUBSCRIPTION`` のものだけを数えるので、単発と無料チケットで公開したものは 8 件の件数に含みません。

料金は単発 299 円、8件まで公開プラン 980 円、公開し放題プラン 2,980 円です。単発は Checkout の ``price_data`` で金額を指定します。定額は Stripe 上の Price ID を ``STRIPE_PRICE_ID_MONTHLY_8`` か ``STRIPE_PRICE_ID_UNLIMITED`` から読みます。

販売価格は ``/console/pricing`` の期間キャンペーンで変わります。単発が 0 円のときは Stripe を通さず、確認済み電話番号の会員へその場で 1 枚を付与します。定額が 0 円のときは 100% off の繰り返しクーポンを付け、カード登録を必須にします。無料期間が終わると定価で自動請求します。終了の 3 日前と 1 日前のメールは ``npm run billing:notices``、または ``POST /api/v1/internal/billing/notices`` を日次で叩いて送ります。``BILLING_NOTICE_SECRET`` が要ります。

npm scripts
-----------

.. list-table::
   :header-rows: 1
   :widths: 28 72

   * - コマンド
     - 内容
   * - ``npm run dev``
     - チラシ API（8000）と Web（3012）を起動する。Web は Turbopack。ビルドが止まったままになったら Web を立て直す
   * - ``npm run dev:clean``
     - ``.next`` を消してから ``npm run dev`` と同じものを起動する。起動方式を変えたとき、ビルドのキャッシュが食い違って直らないとき
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
     - ESLint（キャッシュ）と ``tsc --noEmit`` を並列で走らせ、全部の結果をまとめて出す。1 つでも落ちれば終了コード 1。Vitest とモックの同期は走らない
   * - ``npm run check:full``
     - 上に Vitest と ``docs/testing/scope.rst`` の件数照合を足したもの。CI と PR の前
   * - ``npm run check:serial``
     - ``lint``・``typecheck``・``test`` を順に走らせる。並列で落ちたときに、単体で再現させるため
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

* Dashboard はテストデータ側にする。8件まで公開プラン 980 円と公開し放題プラン 2,980 円（どちらも JPY、月次）の Price ID を ``STRIPE_PRICE_ID_MONTHLY_8`` と ``STRIPE_PRICE_ID_UNLIMITED`` に入れる
* テストカードは ``4242 4242 4242 4242``
* 付与経路は Checkout 戻り先の ``POST /api/v1/billing/checkout/verify`` と、Webhook の ``POST /api/v1/webhooks/stripe`` の 2 つ
* CLI の転送先ポートは ``NEXT_PUBLIC_APP_URL`` に合わせる。``.env.example`` なら 3012

.. code-block:: powershell

   stripe listen --forward-to localhost:3012/api/v1/webhooks/stripe --events checkout.session.completed,invoice.payment_succeeded,invoice.payment_failed,customer.subscription.updated,customer.subscription.deleted,charge.refunded,charge.dispute.created
