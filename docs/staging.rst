検証環境（staging）
====================

このページは、検証環境（staging）を作るときの**差分だけ**を書きます。
Cloudflare・Fly.io・Neon の共通の手順は :doc:`deploy` を見てください。
ローカルの起動は :doc:`local`、DB の操作は :doc:`database`、Stripe のテストは :doc:`stripe` です。

環境は local / staging / production の 3 つです。staging は本番と同じ経路（Cloudflare Tunnel → Fly.io → Neon）を使い、
アプリ名と接続先だけを分けます。本番のデータと決済には触れません。

.. code-block:: text

   利用者
     ↓ Cloudflare（staging ホストには Access を付ける）
   Cloudflare Tunnel（本番と同じ event-creater-tunnel）
     ↓ 6PN event-creater-web-stg.internal:3012
   event-creater-web-stg
     ↓ 6PN event-creater-flyer-stg.internal:8000
   event-creater-flyer-stg
     ↓
   Neon（staging 用の別プロジェクト）

1. 何が違うか
-------------

.. list-table::
   :header-rows: 1
   :widths: 20 38 42

   * - 項目
     - production
     - staging
   * - アプリ名（web）
     - ``event-creater-web``
     - ``event-creater-web-stg``
   * - アプリ名（flyer）
     - ``event-creater-flyer``
     - ``event-creater-flyer-stg``
   * - アプリ名（tunnel）
     - ``event-creater-tunnel``
     - 作らない。本番のトンネルに staging のホスト名を足す
   * - リージョン
     - ``nrt``
     - ``nrt``
   * - Neon
     - 本番プロジェクト
     - 別プロジェクト。本番のデータをコピーしない
   * - Stripe の鍵
     - ``sk_live_`` と本番の Price
     - ``sk_test_`` とテストの Price。Webhook も別の ``whsec_``
   * - GA4
     - 任意（``NEXT_PUBLIC_GA_MEASUREMENT_ID``）
     - 空。計測しない
   * - ``APP_ENV``
     - ``production``
     - ``staging``。noindex の判定に使う
   * - Cloudflare Access
     - 任意
     - staging ホストに必須
   * - ボリューム
     - ``web_storage`` / ``flyer_data`` を各 3GB
     - 同じ名前で各 3GB（ボリュームはアプリごとの名前空間）
   * - 台数
     - 1 台固定（水平スケールしない）
     - 1 台固定（同じ理由）

2. Fly アプリを作る
-------------------

web と flyer を、本番とは別のアプリとして ``nrt`` に作ります。
設定はリポジトリ直下の ``fly.stg.toml`` と ``services/flyer`` の ``fly.stg.toml`` にあります。
``fly.toml`` は本番用なので、staging の操作では必ず ``--config`` で stg 側を指してください。

2 回目以降は手元から ``fly deploy`` しなくても、GitHub Actions の ``Deploy`` が staging へ追従します。
``main`` の CI が緑で終わると staging が先に上がり、そのあと本番が承認を挟んで続きます（:doc:`deploy` の 2.4）。
動かすには environment secrets とリポジトリ変数が要ります。

2.1 web を作る
^^^^^^^^^^^^^^

.. code-block:: powershell

   fly launch --no-deploy --name event-creater-web-stg --region nrt
   fly volumes create web_storage --region nrt --size 3 --app event-creater-web-stg
   fly deploy --config fly.stg.toml

.. warning::

   ``fly launch`` はカレントに ``fly.toml`` を書きます。リポジトリ直下には本番用の ``fly.toml`` があるため、
   実行後に ``git status`` を見て、本番用が書き換わっていないことを確かめてください。
   設定ファイルを触りたくないときは ``fly apps create event-creater-web-stg --org <org>`` でアプリだけ先に作り、
   そのあと ``fly deploy --config fly.stg.toml`` にします。

``fly.stg.toml`` で本番と違うのは次の点です。骨格は ``fly.toml`` と同じです。

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - 設定
     - 内容
   * - ``APP_ENV``
     - ``staging``。``[build.args]`` と ``[env]`` の両方に置きます（後述）
   * - ``NEXT_PUBLIC_APP_URL``
     - ``https://staging.eventkreater.com``。ビルド時に焼き込まれるので ``[build.args]`` にも同じ値
   * - ``NEXT_PUBLIC_GA_MEASUREMENT_ID``
     - 空。staging では計測しない
   * - ``FLYER_API_URL``
     - ``http://event-creater-flyer-stg.internal:8000``。本番の flyer を呼ばない
   * - ``[http_service]``
     - 書かない。公開ポートを持たず、``*.fly.dev`` も生やさない
   * - ``[checks.health]``
     - port 3012、path ``/``。``[http_service.checks]`` の代わりにアプリ単位で書く
   * - ``[[mounts]]``
     - ``web_storage`` → ``/app/storage``。3GB

ボリュームの所有者は初回だけ変えます。本番と同じく、root 所有のままだとチラシ画像の保存が ``EACCES`` で失敗します。

.. code-block:: powershell

   fly ssh console --app event-creater-web-stg -C "chown -R 1001:1001 /app/storage"
   fly ssh console --app event-creater-web-stg -C "ls -ld /app/storage"

シークレットは名前を本番とそろえ、値だけ staging のものにします。

.. code-block:: powershell

   fly secrets set `
     DATABASE_URL="postgresql://...staging...?sslmode=require" `
     JWT_SECRET="..." `
     STRIPE_SECRET_KEY="sk_test_..." `
     STRIPE_WEBHOOK_SECRET="whsec_..." `
     STRIPE_PRICE_ID_MONTHLY_8="price_..." `
     STRIPE_PRICE_ID_UNLIMITED="price_..." `
     STRIPE_PRICE_ID_ONE_TIME="price_..." `
     --app event-creater-web-stg

``NEXT_PUBLIC_*`` と ``APP_ENV`` はビルド時に埋め込まれるため、``fly secrets set`` ではなく ``fly.stg.toml`` の
``[build.args]`` で渡します。

2.2 flyer を作る
^^^^^^^^^^^^^^^^

.. code-block:: powershell

   cd services\flyer
   fly launch --no-deploy --name event-creater-flyer-stg --region nrt
   fly volumes create flyer_data --region nrt --size 3 --app event-creater-flyer-stg
   fly secrets set OPENAI_API_KEY="sk-..." --app event-creater-flyer-stg
   fly deploy --config fly.stg.toml

``services/flyer`` の ``fly.stg.toml`` は本番の ``fly.toml`` と同じで、アプリ名だけが ``-stg`` です。
``STORAGE_DIR`` / ``CANDIDATE_DIR`` / ``FALLBACK_DIR`` と ``flyer_data`` の 3GB も本番と同じです。
``fly launch`` が ``services/flyer`` の ``fly.toml``（本番用）を書き換えないよう、こちらも ``git status`` で確認します。

``OPENAI_API_KEY`` は本番と同じ鍵でも動きます。原価を環境ごとに見分けたいときだけ、別のプロジェクトの鍵にします。
未設定でも起動しますが、そのときはモックのアダプターに切り替わり、本物ではない候補が静かに返ります。

2.3 メール送信（Resend と Worker）
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

staging では、会員登録の確認メールを実際に送ります。``src/lib/mail.ts`` の ``deliverMail()`` は
``MAIL_WEBHOOK_URL`` へ認証ヘッダを付けずに ``{ to, subject, body }`` を POST するだけです。
その受け口を Cloudflare Worker に置き、Worker から Resend で送ります。アプリ側は変えません。

Worker のコードは ``infra/mail-webhook`` に置きます（``infra/mail-webhook/wrangler.toml`` と ``infra/mail-webhook/src/index.mjs``）。

.. code-block:: text

   event-creater-web-stg（deliverMail）
     ↓ POST { to, subject, body } を認証ヘッダなしで送る
   mail-hook-stg.eventkreater.com（Worker）
     ↓ POST /emails を Bearer で送る
   Resend（送信ドメイン send-stg.eventkreater.com）
     ↓
   運用者のメール

ホスト名は 2 つに分けます。同じ名前にすると、Worker の custom domain と Resend の DKIM が DNS で衝突します。

.. list-table::
   :header-rows: 1
   :widths: 24 76

   * - 用途
     - ホスト名
   * - Worker の受け口
     - ``mail-hook-stg.eventkreater.com``。アプリは ``https://mail-hook-stg.eventkreater.com/<token>`` へ POST します
   * - Resend の送信ドメイン
     - ``send-stg.eventkreater.com``。``from`` は ``no-reply@send-stg.eventkreater.com`` です

Resend のダッシュボードで ``send-stg.eventkreater.com`` を追加し、SPF・DKIM・MX を Cloudflare DNS に
**DNS only** で置いて認証を通します。

Worker の秘密は 4 つです。``infra\mail-webhook`` で 1 つずつ入れてからデプロイします。

.. code-block:: powershell

   cd infra\mail-webhook
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put WEBHOOK_TOKEN
   npx wrangler secret put MAIL_FROM
   npx wrangler secret put ALLOWED_RECIPIENTS
   npx wrangler deploy

.. list-table::
   :header-rows: 1
   :widths: 28 72

   * - 名前
     - 値
   * - ``RESEND_API_KEY``
     - Resend の API キー
   * - ``WEBHOOK_TOKEN``
     - アプリが URL のパスに載せる合言葉。一致しないパスは 404 になります
   * - ``MAIL_FROM``
     - ``no-reply@send-stg.eventkreater.com``
   * - ``ALLOWED_RECIPIENTS``
     - 送ってよい宛先。ここに無い宛先は 403 で止めます

``[stg]`` は ``wrangler.toml`` の ``[vars] SUBJECT_PREFIX`` で決まります（以前は ``handler.mjs`` の定数でした）。
Worker は受け取った件名の頭にこれを付け、本文はプレーンテキストのまま Resend へ渡します。

.. warning::

   ``mail-hook-stg.eventkreater.com`` に Cloudflare Access を付けないでください。
   Access はブラウザのログインを要求します。``deliverMail`` は認証ヘッダを付けられないため、
   Worker の手前で 302 に止められ、メールが届きません。Access を付けるのは ``staging.eventkreater.com`` だけです。

最後に、アプリの宛先を Worker に切り替えます。``MAIL_WEBHOOK_URL`` は実行時の env なので再ビルドは要りません
（``fly secrets set`` で Machine は再起動します）。

.. code-block:: powershell

   fly secrets set MAIL_WEBHOOK_URL="https://mail-hook-stg.eventkreater.com/<token>" --app event-creater-web-stg

2.4 Tunnel に staging のホスト名を足す
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

staging 用のトンネルアプリは作りません。本番の ``event-creater-tunnel`` の Public Hostname に 1 行足します。

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - 項目
     - 値
   * - ホスト名
     - ``staging.eventkreater.com``
   * - サービス
     - ``http://event-creater-web-stg.internal:3012``
   * - キャッシュ
     - ``/api/*`` は Bypass cache（本番と同じ）。``/_next/static/*`` はアプリが ``immutable`` を返すので追加のルールは要らない

.. note::

   ホスト名を足しただけでは 503 が返ることがあります。Public Hostname が保存されているか（ingress の一覧に出ているか）を確かめてください。詳しくは :doc:`deploy` の 2.3 にあります。

web 側に ``[http_service]`` が無いので、``*.fly.dev`` は生まれません。
``fly ips list --app event-creater-web-stg`` が空であることで確かめられます。
cloudflared は同じ organization の 6PN で ``event-creater-web-stg.internal`` を引くため、トンネルは 1 本で足ります。

3. Neon を分ける
----------------

Neon は本番と別のプロジェクトにします。本番のダンプやブランチを staging へ持ってきません。
参加者の氏名・電話番号・メールが staging に流れ込むためです。

1. Neon のコンソールでプロジェクトを新しく作ります（PostgreSQL 18。2026-11-03 に作成した 2 プロジェクトは 18 です）。
2. 接続文字列は Direct connection（``-pooler`` が付かないホスト）に ``sslmode=require`` を付けます。web は 1 台なのでプールは要りません。
3. マイグレーションは、手元から staging の Direct へ流します（:doc:`deploy` と同じです）。

.. code-block:: powershell

   $env:DATABASE_URL = "postgresql://...staging...?sslmode=require"
   npx prisma migrate deploy
   npx prisma migrate status

.. warning::

   本番のデータをコピーしないでください。個人情報を staging に持ち込みません。
   テスト用の会員と催しは staging で作り直します（作り方はこのページの最後）。

4. Stripe をテストモードに固定する
----------------------------------

staging は Stripe のテストモードだけを使います。

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - 項目
     - staging で使うもの
   * - 秘密鍵
     - ``sk_test_`` だけ。``sk_live_`` は入れない
   * - Price
     - テストモードで作った Price。``STRIPE_PRICE_ID_MONTHLY_8`` / ``STRIPE_PRICE_ID_UNLIMITED`` / ``STRIPE_PRICE_ID_ONE_TIME`` と、既存契約の検証用 ``STRIPE_PRICE_ID_MONTHLY_980_LEGACY``
   * - Webhook
     - ``https://staging.eventkreater.com/api/v1/webhooks/stripe``。テストモードで作り、本番とは別の ``whsec_`` を ``STRIPE_WEBHOOK_SECRET`` に入れる
   * - Customer Portal
     - テストモードで有効にする。返金は Dashboard から行う（本番と同じ）

``src/modules/billing/lib/stripe.ts`` の ``stripeExpectsLive()`` は、``STRIPE_SECRET_KEY`` に ``_live_`` が
含まれるかどうかだけで本番かを判定します。staging に本番キーを 1 つでも入れると ``true`` になり、
本番の顧客と請求に触れる経路ができます。テストキー・テストの Price・別の ``whsec_`` を 1 組でそろえ、
本番の値と混ぜないでください。

Test Clock もテストモードでだけ使えます。受け入れ確認の 4 番目で使います。

5. staging を守る
-----------------

staging にはテスト決済とダミーデータが見えます。URL を知っている人が開ける状態にしないでください。

- **Cloudflare Access を staging ホストに付けます。** 2026-11-03 時点では Zero Trust の組織を ``eventkreater.cloudflareaccess.com`` にし、self-hosted アプリを 1 つ、Allow を運用者のメール 1 件だけで作っています。ログイン方法は One-time PIN です。Access は IdP が 1 つも無いと「ログイン方法がありません」で止まるので、**Settings → Authentication** で One-time PIN を有効にしてからアプリの ``allowed_idps`` に入れます。メールを足すときは、この Allow ポリシーに足します。
- ``APP_ENV=staging`` の noindex は**二重の保険**です。``src/app/robots.ts`` が全パスを disallow した robots.txt を返し、``next.config.mjs`` の ``headers()`` が全パスに ``X-Robots-Tag: noindex, nofollow`` を付けます。検索に出ないだけで、URL を開けば見えます。Access の代わりにはなりません。
- ``APP_ENV`` は ``[build.args]`` と ``[env]`` の両方に置きます。``headers()`` はビルド時に評価され、``robots.ts`` は ``force-dynamic`` で実行時に読むためです。片方だけだと noindex が効きません。
- ``*.fly.dev`` を生やしません。``[http_service]`` を書かなければ公開経路は Tunnel だけになり、Access も Tunnel も迂回できません。

6. 受け入れ確認
---------------

staging にデプロイしたあと、上から順に確かめます。失敗したらそこで止めます。

.. note::

   2026-11-03 時点で、``staging.eventkreater.com`` が 302 で Access へ送るところまでを確認しています。
   以降の行は未実施です（Stripe のテスト鍵もまだ入れていません）。

* ``[ ]`` ``GET /api/v1/public/pricing`` が 200 を返す
* ``[ ]`` 会員登録 → 電話確認 → ``/mypage`` まで進める。Cookie が ``__Host-`` で始まる
* ``[ ]`` 登録すると ``[stg] メールアドレスの確認`` が届く
* ``[ ]`` ``fly logs -a event-creater-web-stg`` に ``[mail]`` が出ない（出たら未送信。``deliverMail`` は失敗を呼び出し元に返さないので、気づく手段はこのログだけ）
* ``[ ]`` 無料チケットを 2 枚作り、3 件目で料金モーダルが出る。``4242 4242 4242 4242`` で払い、``verify`` と Webhook の両方が 200 で、二重付与しない
* ``[ ]`` Test Clock で初月無料 → 3 日前 / 1 日前の通知 → 定価の請求、まで進み、``trial_ends_at`` が NULL になる
* ``[ ]`` ``4000 0000 0000 0002`` で ``PAST_DUE`` になり、イベント作成が 402 を返す
* ``[ ]`` チラシ候補が出て画像が返る（500 なら flyer の ``OPENAI_API_KEY`` とフォント、web の ``chown`` を疑う）
* ``[ ]`` ``*.fly.dev`` が引けないこと、``staging.eventkreater.com`` が 302 で Access に止められ、ログイン後に ``X-Robots-Tag: noindex, nofollow`` が返ること
* ``[ ]`` ``curl -I https://staging.eventkreater.com/`` の応答に ``X-Content-Type-Options: nosniff``、``Referrer-Policy: strict-origin-when-cross-origin``、``X-Frame-Options: DENY``、``Permissions-Policy``、``Content-Security-Policy``（``frame-ancestors 'none'`` を含む）が付く。``Strict-Transport-Security`` は付かない
* ``[ ]`` ``/invitations/{code}`` の応答に ``X-Robots-Tag: noindex, nofollow`` が付き、HTML の ``robots`` も ``noindex, nofollow`` になる
* ``[ ]`` 390px の実機で ``/events/{id}`` の出欠が片手で完結する

7. staging のデータを作り直す
-----------------------------

staging 用のデータを初期化する手順は**まだ決めていません**。決まったらこの節に追記します。
決まるまでは、画面から必要な会員と催しを作ってください。

SMS は送りません。``SMS_WEBHOOK_URL`` は空のままで、電話番号の確認の 6 桁コードは
``fly logs -a event-creater-web-stg`` の ``[sms]`` から拾います。

.. warning::

   ``npm run db:seed:ui`` は staging で使わないでください。開発用で、``storage/ui-demo.json`` を書き出し、
   ``public/samples/*.jpg`` をローカルの ``storage/flyers/`` へコピーします。モック撮影のための見本なので、
   staging の DB とボリュームをそろえる用途には合いません。``npm run db:seed`` もローカル用です。

.. warning::

   ``npx prisma migrate reset`` は staging でも本番でも実行しないでください。DB を落として作り直すコマンドです。
   作り直したいときは、新しい Neon プロジェクトを用意し、``npx prisma migrate deploy`` からやり直します。

いま管理者を作るときは、``DATABASE_URL`` を staging の Direct に向けた手元で、会員登録したメールアドレスを渡します。

.. code-block:: powershell

   $env:DATABASE_URL = "postgresql://...staging...?sslmode=require"
   npm run admin:promote -- user@example.com

``scripts/promote-admin.mjs`` は既存の会員を管理者にするだけです。会員そのものは先に画面から作ります。
