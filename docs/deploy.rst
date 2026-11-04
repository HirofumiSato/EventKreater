本番デプロイ
============

このページは、手元で動く状態から本番へ出すまでの手順です。対象は次の構成です。

.. code-block:: text

   利用者
     ↓
   Cloudflare（DNS・WAF・Access）
     ↓
   event-creater-tunnel（cloudflared / Fly.io nrt）
     ↓ 6PN
   event-creater-web（Next.js standalone / Fly.io nrt）
     ├─ 6PN → event-creater-flyer（FastAPI + Pillow + OpenAI）
     ├─ Neon（PostgreSQL）
     ├─ Fly ボリューム web_storage（/app/storage）
     └─ Stripe（Webhook は web が受ける）

利用者が開くのは Cloudflare だけで、web は公開ポートを持ちません。アプリ名は prod が ``event-creater-web`` / ``event-creater-flyer`` / ``event-creater-tunnel``、staging が ``event-creater-web-stg`` / ``event-creater-flyer-stg`` です。

ローカル起動は :doc:`local`、DB の操作は :doc:`database`、Stripe のテストは :doc:`stripe` を見てください。
このページは「本番でだけ違うこと」だけを書きます。

.. mermaid::

   flowchart TD
      U["利用者"] --> CF["Cloudflare<br/>DNS / WAF / Access"]
      CF -->|"Tunnel"| TN["event-creater-tunnel<br/>cloudflared / Fly.io nrt"]
      TN -->|"6PN http://event-creater-web.internal:3012"| WEB["event-creater-web<br/>Next.js standalone :3012"]
      WEB -->|"6PN http://event-creater-flyer.internal:8000"| FLYER["event-creater-flyer<br/>FastAPI :8000"]
      WEB --> NEON[("Neon PostgreSQL")]
      WEB --> VOL1[("Fly ボリューム web_storage<br/>/app/storage")]
      FLYER --> VOL2[("Fly ボリューム flyer_data<br/>/data")]
      FLYER --> OPENAI["OpenAI API"]
      WEB --> STRIPE["Stripe"]
      STRIPE -->|"Webhook"| WEB

.. note::

   2026-11-03 に、この構成を ``eventkreater.com`` で実際に通しました。Fly.io（``nrt``）の 4 アプリと tunnel、
   Cloudflare Tunnel 経由の公開、Neon への接続、GitHub Actions の自動デプロイまで動いています。
   確認したことは次のとおりです。

   .. list-table::
      :header-rows: 1
      :widths: 44 56

      * - 確かめたこと
        - 結果
      * - ``https://eventkreater.com/``
        - 200。``CF-RAY`` が付くので Cloudflare を経由している
      * - ``https://eventkreater.com/api/v1/public/pricing``
        - 200。Neon への接続とマイグレーションが効いている
      * - ``https://staging.eventkreater.com/``
        - 302。Cloudflare Access のログイン画面へ送る
      * - ``POST /api/v1/voice/transcriptions``
        - 実際の音声で 200。``model`` が ``gpt-4o-mini-transcribe`` ならモックではない
      * - 5 アプリの ``fly checks list``
        - すべて ``passing``
      * - GitHub Actions の ``Deploy``
        - staging / production とも ``migrate`` → ``flyer`` → ``web`` が success

   まだ通していないのは Stripe です（手順 4）。鍵を入れるまで、契約・Portal・Webhook は動きません。
   無料の範囲だけが使え、手順 5 のうち Stripe の行は確かめられません。

0. 前提
-------

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - 用意するもの
     - 補足
   * - Fly.io アカウントと ``flyctl``
     - 支払い方法の登録が要ります。リージョンは ``nrt`` です（東京）
   * - Cloudflare のドメイン
     - ネームサーバーを Cloudflare に向けます。無料プランで足ります
   * - Neon のプロジェクト
     - PostgreSQL 16。無料プランから始めます
   * - Stripe の本番キー
     - ``sk_live_`` と Webhook の署名シークレット。テストは :doc:`stripe`
   * - OpenAI の API キー
     - チラシ生成サービスだけが使います
   * - Node.js 24 以上
     - マイグレーションを手元から流すので、リポジトリで ``npm ci`` 済みにしておきます

1. Neon に DB を作る
--------------------

Neon のコンソールでプロジェクトを作り、接続文字列を 2 つ控えます。

.. list-table::
   :header-rows: 1
   :widths: 24 34 42

   * - 用途
     - 使う文字列
     - 理由
   * - アプリの実行時（1 台）
     - Direct connection（``-pooler`` が付かないホスト）
     - ``prisma/schema.prisma`` に ``directUrl`` が無いため、そのまま使えるのはこちら。1 台なら接続数も足ります
   * - アプリの実行時（2 台以上）
     - Pooled connection（``-pooler`` が付くホスト）
     - 接続を使い回す。``?pgbouncer=true&connection_limit=1`` を付けます
   * - マイグレーション
     - Direct connection
     - PgBouncer 越しの ``CREATE INDEX`` やトランザクションを避ける

.. important::

   このリポジトリの ``prisma/schema.prisma`` は ``url = env("DATABASE_URL")`` だけで、``directUrl`` を持っていません。
   そのため **最初は direct の接続文字列を ``DATABASE_URL`` に入れてください。**
   Pooled に切り替えるのは web を 2 台以上にするときで、そのときもマイグレーションは direct で流します。

マイグレーションはアプリのイメージに Prisma CLI が入っていないため、**デプロイの前に手元（または CI）から流します。**
リポジトリ直下で、Neon の direct 文字列を一時的に渡します。

.. code-block:: powershell

   $env:DATABASE_URL = "postgresql://...@ep-xxx.ap-northeast-1.aws.neon.tech/neondb?sslmode=require"
   npx prisma migrate deploy
   npx prisma migrate status

.. note::

   ``prisma migrate deploy`` は既存のマイグレーションを順に適用するだけで、スキーマを差分から作り直しません。
   ``prisma db push`` は部分ユニーク索引（``event_organizers_one_owner`` など）や CHECK 制約を作らないので、本番では使いません。CI と同じ理由です。

2. Fly.io にアプリを 3 つ作る
-----------------------------

web・flyer・tunnel は別アプリにします。web も flyer も公開ポートを持たず、web へは tunnel が、flyer へは web が 6PN（``<app>.internal``）でだけ届きます。

2.1 flyer を先に作る
^^^^^^^^^^^^^^^^^^^^

.. code-block:: powershell

   cd services\flyer
   fly launch --no-deploy --name event-creater-flyer --region nrt

生成された ``fly.toml`` を次の内容にします。``fly launch`` が自動で足す ``http_service`` は消してください（公開しないためです）。

.. code-block:: toml

   app = "event-creater-flyer"
   primary_region = "nrt"

   [build]
     dockerfile = "Dockerfile"
     target = "runtime"

   [env]
     STORAGE_DIR = "/data/tmp"
     CANDIDATE_DIR = "/data/candidates"
     FALLBACK_DIR = "/data/backgrounds"

   [[mounts]]
     source = "flyer_data"
     destination = "/data"

   # 公開サービスを持たないので、ヘルスチェックはアプリ単位で書く。
   [checks.health]
     type = "http"
     port = 8000
     path = "/health"
     interval = "15s"
     timeout = "2s"
     grace_period = "10s"

   [[vm]]
     size = "shared-cpu-1x"
     memory = "1gb"

ボリュームを作り、秘密を入れてからデプロイします。

.. code-block:: powershell

   fly volumes create flyer_data --region nrt --size 3
   fly secrets set OPENAI_API_KEY="sk-..."
   fly deploy

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - 環境変数
     - 必須か
   * - ``OPENAI_API_KEY``
     - 本番では必須。**未設定でも起動します。** そのときはモックのアダプターに切り替わり、本物ではない候補が静かに返ります
   * - ``OPENAI_TEXT_MODEL`` / ``OPENAI_IMAGE_MODEL``
     - 任意。既定は ``gpt-4o-mini`` と ``gpt-image-2.5-flare``（``IMAGE_QUALITY=low``、``IMAGE_SIZE=1024x1536``）
   * - ``STORAGE_DIR`` / ``CANDIDATE_DIR`` / ``FALLBACK_DIR``
     - 上の ``fly.toml`` で固定。ボリュームを外すと再起動で候補が消えます
   * - ``CANDIDATE_TTL_SECONDS`` / ``TTL_SECONDS``
     - 任意。既定は 3600 秒。``TTL_SECONDS`` は古い候補の掃除に使います
   * - ``AI_CANDIDATES_ENABLED`` / ``AI_CANDIDATE_MAX_PER_HOUR`` / ``USD_JPY_RATE``
     - 任意。AI 背景候補の有無と 1 時間あたりの枚数（既定 3）、原価見積りの為替（既定 200）

日本語フォントはイメージに ``fonts-noto-cjk`` として入っています。ローカルと同じく、無いと ``FontRenderError`` で全滅します。

2.2 web を作る
^^^^^^^^^^^^^^

.. code-block:: powershell

   cd ..\..
   fly launch --no-deploy --name event-creater-web --region nrt

``fly.toml`` は次の内容にします。``NEXT_PUBLIC_APP_URL`` と ``NEXT_PUBLIC_GA_MEASUREMENT_ID`` はビルド時に焼き込まれるので、``[build.args]`` で渡します。

.. code-block:: toml

   app = "event-creater-web"
   primary_region = "nrt"

   [build]
     dockerfile = "Dockerfile"
     target = "runner"
     [build.args]
       NEXT_PUBLIC_APP_URL = "https://eventkreater.com"
       # GA4 の測定 ID（プロパティ「EventKreater 本番」/ ストリーム「EventKreater 本番 Web」）。staging は空のまま。
       NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-BS6RHPS9J3"
       # APP_ENV（staging の noindex 判定）もビルド時に評価されるため、ここで渡します。
       APP_ENV = "production"

   [env]
     NODE_ENV = "production"
     PORT = "3012"
     FLYER_API_URL = "http://event-creater-flyer.internal:8000"
     # ビルド引数と同じ値。実行時の絶対 URL にも使う。
     NEXT_PUBLIC_APP_URL = "https://eventkreater.com"
     # ビルド引数と同じ値を実行時にも渡します。robots.ts は force-dynamic で
     # 実行時に APP_ENV を読むため、ビルド側だけでは足りません。
     APP_ENV = "production"

   # 公開ポートは持たない。外から届くのは Cloudflare Tunnel の 6PN だけなので、
   # [http_service] を書かず（*.fly.dev も公開しない）、ヘルスチェックだけをアプリ単位で置く。
   [checks.health]
     type = "http"
     port = 3012
     path = "/"
     interval = "15s"
     timeout = "5s"
     grace_period = "10s"

   [[mounts]]
     source = "web_storage"
     destination = "/app/storage"

   [[vm]]
     size = "shared-cpu-1x"
     memory = "1gb"

.. note::

   本番の ``NEXT_PUBLIC_GA_MEASUREMENT_ID`` は ``G-BS6RHPS9J3`` （プロパティ「EventKreater 本番」/ ストリーム「EventKreater 本番 Web」）です。staging は空のままで、計測しません。

.. note::

   ``APP_ENV`` も ``[build.args]`` と ``[env]`` の両方に置きます。``next.config.mjs`` の ``headers()`` はビルド時に評価され、環境ごとに付けるヘッダが変わります。全環境に ``X-Content-Type-Options``・``Referrer-Policy``・``X-Frame-Options``・``Permissions-Policy``・``Content-Security-Policy`` を付け、``production`` のときだけ ``Strict-Transport-Security``、``staging`` のときは全パスに ``X-Robots-Tag: noindex, nofollow`` を付けます。``staging`` 以外では秘匿パス（``/console``・``/invitations``・``/participant`` など）にだけ ``X-Robots-Tag`` を付けます。staging へ出すときは ``"staging"`` を渡してください（``robots.ts`` が実行時に読むぶんは ``[env]`` 側です）。理由は :doc:`staging` と :doc:`issues/abuse-and-crawler-hardening` にまとめてあります。

.. important::

   ``NEXT_PUBLIC_APP_URL`` と ``NEXT_PUBLIC_GA_MEASUREMENT_ID`` は **ビルド時に埋め込まれます**。値を変えたら ``fly deploy`` し直してください。
   シークレットとして ``fly secrets set`` しても、既にビルドされた JS は変わりません。

.. warning::

   web と flyer は IPv4 と IPv6 の両方で待ち受けてください。片方だけだと、届かない経路ができます。

   - web は ``Dockerfile`` の ``HOSTNAME=::`` で両方受けます（Node は ``IPV6_V6ONLY=0`` を明示するため dual-stack になります）。
   - flyer は ``services/flyer/entrypoint.py`` が ``IPV6_V6ONLY=0`` を立てたソケットを作り、uvicorn へ ``--fd`` で渡します。``uvicorn --host ::`` だけだと、このイメージでは IPv6 専用になり、Fly のヘルスチェック（``127.0.0.1`` への IPv4）が ``connection refused`` になります。``--host 0.0.0.0`` にすると逆に 6PN から届きません。

   ``0.0.0.0`` は IPv4 だけの待ち受けになり、Fly のプロキシも Cloudflare Tunnel も 6PN（``fdaa:...`` の IPv6）で来るため、
   外から 1 本も届きません。しかも Fly のヘルスチェックは機械の中から繋ぐので通ってしまい、デプロイは成功に見えます。
   2026-11-03 の初回デプロイで実際に踏みました。``flyctl proxy`` や Tunnel 経由で確かめれば、その場で分かります。
   同じ日に flyer でも踏んでいます（ヘルスチェックだけが落ちる）。``fly checks list`` と ``flyctl proxy`` の両方で確かめてください。

.. note::

   Fly のトライアル（支払い方法の未登録）では、機械は **起動から 5 分で止められます**。
   ログには ``Trial machine stopping. To run for longer than 5m0s, add a credit card`` と出ます。
   構成の問題に見えるので、最初にログを読んでください。継続して動かすには https://fly.io/trial で支払い方法を登録します。

環境変数は次のとおりです。``fly secrets set`` で入れるものと、``fly.toml`` の ``[build.args]`` で渡すものがあります。

.. list-table::
   :header-rows: 1
   :widths: 32 14 54

   * - 名前
     - 必須
     - 内容
   * - ``DATABASE_URL``
     - 必須
     - Neon の接続文字列。``sslmode=require`` を付けます
   * - ``JWT_SECRET``
     - 必須
     - 32 文字以上。ログイン Cookie と電話番号・ログイン試行のハッシュに使います
   * - ``NEXT_PUBLIC_APP_URL``
     - 必須
     - 公開 URL。ビルド引数と同じ値を実行時にも渡します
   * - ``NEXT_PUBLIC_GA_MEASUREMENT_ID``
     - 任意
     - GA4 の測定 ID（``G-...``）。空なら計測しません。``[build.args]`` で渡すビルド時の値なので、変えたら ``fly deploy`` し直します
   * - ``FLYER_API_URL``
     - 必須
     - ``http://event-creater-flyer.internal:8000``
   * - ``STRIPE_SECRET_KEY``
     - 必須
     - ``sk_live_...``。``_live_`` を含むかどうかで本番判定をしています
   * - ``STRIPE_WEBHOOK_SECRET``
     - 必須
     - Webhook の署名シークレット。違うと ``/api/v1/webhooks/stripe`` が 400 を返します
   * - ``STRIPE_PRICE_ID_MONTHLY_8``
     - 必須
     - 月額で8件まで公開プランの Price ID
   * - ``STRIPE_PRICE_ID_UNLIMITED``
     - 必須
     - 公開し放題の Price ID
   * - ``STRIPE_PRICE_ID_MONTHLY_980_LEGACY``
     - 任意
     - 値上げ前に加入した 980 円の公開し放題の Price ID。既存契約の検証だけに使います。名前を変える前の ``STRIPE_PRICE_ID_MONTHLY_980`` も同じ用途で読みます
   * - ``STRIPE_PRICE_ID_ONE_TIME``
     - 必須
     - 単発の Price ID
   * - ``GOOGLE_CLIENT_ID`` / ``GOOGLE_CLIENT_SECRET``
     - 任意
     - 両方そろったときだけ Google ログインが出ます
   * - ``MAIL_WEBHOOK_URL``
     - 必須
     - メール中継（Cloudflare Worker）の URL。未設定だと確認メールも課金の事前通知も届かず、会員登録が成立しません。同じホストの設定は下の「メール配送（Resend と Worker）」と :doc:`staging` にあります
   * - ``SMS_WEBHOOK_URL``
     - 必須
     - SMS 中継（Cloudflare Worker）の URL。未設定だと電話番号確認のコードが届かず、新規登録が電話確認で止まります。同じホストの設定は下の「SMS 配送（Twilio と Worker）」と :doc:`staging` にあります
   * - ``POSTAL_CODE_API_URL``
     - 任意
     - 既定は zipcloud。変えるときだけ
   * - ``BILLING_NOTICE_SECRET``
     - 任意
     - ``/api/v1/internal/billing/notices`` を叩くときの共有秘密
   * - ``AUTH_ATTEMPT_LIMIT`` ほか ``AUTH_*``
     - 任意
     - 試行回数の上限。既定値は ``src/modules/auth/lib/rate-limits.ts``

ボリュームを作り、秘密を入れてからデプロイします。

.. code-block:: powershell

   fly volumes create web_storage --region nrt --size 3

   fly secrets set `
     DATABASE_URL="postgresql://...@ep-xxx.ap-northeast-1.aws.neon.tech/neondb?sslmode=require" `
     JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" `
     STRIPE_SECRET_KEY="sk_live_..." `
     STRIPE_WEBHOOK_SECRET="whsec_..." `
     STRIPE_PRICE_ID_MONTHLY_8="price_..." `
     STRIPE_PRICE_ID_UNLIMITED="price_..." `
     STRIPE_PRICE_ID_ONE_TIME="price_..." `
     GOOGLE_CLIENT_ID="..." `
     GOOGLE_CLIENT_SECRET="..." `
     MAIL_WEBHOOK_URL="https://mail-hook.eventkreater.com/<WEBHOOK_TOKEN>" `
     SMS_WEBHOOK_URL="https://sms-hook.eventkreater.com/<WEBHOOK_TOKEN>" `
     BILLING_NOTICE_SECRET="..."

   fly deploy

この時点では web に外から到達できません。公開は手順 2.3 の Tunnel で行います。先に ``fly checks list --app event-creater-web`` でヘルスチェックだけ確かめておくと切り分けが楽です。

.. important::

   コンテナは ``nextjs`` で動きます（uid 1001）。マウントしたボリュームのルートは root 所有で作られるため、
   初回だけ所有者を変えないとチラシ画像の保存に失敗します（``EACCES``）。

   .. code-block:: powershell

      fly ssh console -C "chown -R 1001:1001 /app/storage"
      fly ssh console -C "ls -ld /app/storage"

   ローカルの Docker で直したのと同じ問題です。詳細は :doc:`local` の「Docker で動かす」にあります。

メール配送（Resend と Worker）
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

.. note::

   この節は手順 2.3 の前に入ります。既存の節番号（2.3・2.4）を変えないため、番号は付けていません。

本番のアプリは、確認メールと課金の事前通知を ``MAIL_WEBHOOK_URL`` へ POST するだけで、送信は自分では行いません。
受け口の Cloudflare Worker（``infra/mail-webhook``）が Resend に渡します。仕組みと staging 側の手順は
:doc:`staging` の 2.3 にあり、ここでは本番との差分だけを書きます。

本番は staging と別の Worker・別のホスト・別の送信ドメインを使います。同じ名前にすると、
Worker の custom domain と Resend の DKIM が DNS で衝突します。

.. list-table::
   :header-rows: 1
   :widths: 12 26 22 24 16

   * - 環境
     - config
     - Worker 名
     - ホスト名
     - 件名の接頭辞
   * - staging
     - ``infra/mail-webhook/wrangler.toml``
     - ``event-creater-mail-stg``
     - ``mail-hook-stg.eventkreater.com``
     - ``[stg]`` と半角スペース
   * - production
     - ``infra/mail-webhook/wrangler.prod.toml``
     - ``event-creater-mail``
     - ``mail-hook.eventkreater.com``
     - なし

1. Resend のダッシュボードで、本番の送信ドメイン ``send.eventkreater.com`` を追加します。
2. 表示される 3 行（CNAME 2 本と DKIM の TXT）を、そのまま Cloudflare DNS に入れます。すべて **DNS only** にします（灰色雲）。Proxy（オレンジ雲）にすると Resend の検証が通りません。SPF と MX を別に作る必要はありません。SPF は CNAME の先が返します。

   .. code-block:: text

      send.send.eventkreater.com            CNAME  send.forge.rmta.net
      rsend.send.eventkreater.com           CNAME  rsend-apne1.forge.rmta.net
      resend._domainkey.send.eventkreater.com  TXT  p=...

   DoH で引くと、``send.send.*`` は ``v=spf1 ip4:... ~all``、``rsend.send.*`` は ``v=spf1 include:amazonses.com ~all`` を返します。SPF は CNAME の先が持っているので、このゾーンには SPF の TXT も ``feedback-smtp...`` の MX も作りません。

3. DMARC は ``_dmarc.eventkreater.com`` の TXT に ``v=DMARC1; p=none; adkim=r; aspf=r`` を入れます。``rua`` は付けていません。このゾーンには MX が 1 つも無く、レポートの宛先にできる実在の受信箱を決められないためです。``rua`` を付けるときは、先に受信できる宛先を用意してください。DKIM と SPF が通るのを見るまで ``p=reject`` にしないでください。
4. Worker をデプロイします。ふだんは CI（``.github/workflows/deploy-env.yml`` の ``mail`` ジョブ）が上げます。environment secrets の ``CLOUDFLARE_API_TOKEN`` と ``CLOUDFLARE_ACCOUNT_ID`` が入っているときだけ動き、未設定ならジョブを飛ばします。初回だけ、手元で秘密を 4 つ入れてからデプロイします。

.. code-block:: powershell

   cd infra\mail-webhook
   npx wrangler secret put RESEND_API_KEY        --config wrangler.prod.toml
   npx wrangler secret put WEBHOOK_TOKEN         --config wrangler.prod.toml
   npx wrangler secret put MAIL_FROM             --config wrangler.prod.toml
   npx wrangler secret put ALLOWED_RECIPIENTS    --config wrangler.prod.toml
   npx wrangler deploy --config wrangler.prod.toml

秘密の値は次のとおりです。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 名前
     - 値
   * - ``MAIL_FROM``
     - ``no-reply@send.eventkreater.com``
   * - ``ALLOWED_RECIPIENTS``
     - ``*``。本番は参加者・主催者の任意の宛先へ送ります。空にすると全拒否です
   * - ``SUBJECT_PREFIX``
     - 空。``wrangler.prod.toml`` に書かず、既定の空を使います。秘密ではないので ``wrangler secret put`` では入れません

5. アプリの宛先を Worker に切り替えます。``MAIL_WEBHOOK_URL`` は実行時の env なので再ビルドは要りません（``fly secrets set`` で Machine は再起動します）。

.. code-block:: powershell

   fly secrets set MAIL_WEBHOOK_URL="https://mail-hook.eventkreater.com/<WEBHOOK_TOKEN>" --app event-creater-web

6. Cloudflare の **Security → WAF → Rate limiting rules** で、既存の ``/console/`` のルールに OR でメール中継と SMS 中継のホストを足します。無料枠は **1 ゾーンにつきルール 1 本まで** なので、``mail-hook.eventkreater.com`` や ``sms-hook.eventkreater.com`` 用に 2 本目は作れません。2 本目を足すと API は ``50001 exceeded the maximum number of rules in the phase http_ratelimit: 2 out of 1`` を返します。

   - 式: ``(starts_with(http.request.uri.path, "/console/")) or (http.host eq "mail-hook.eventkreater.com") or (http.host eq "sms-hook.eventkreater.com")``
   - しきい値: ``20 requests / 10 seconds``、characteristics は ``ip.src`` と ``cf.colo.id``、``mitigation_timeout`` は 10 秒、action は ``block``

   無料枠は 10 秒の窓しか選べません。トークンを知らない相手の総当たりを減らすための保険です。

.. warning::

   ``mail-hook.eventkreater.com`` に Cloudflare Access を付けないでください。Access はブラウザのログインを要求し、
   ``deliverMail`` は認証ヘッダを付けられないため、Worker の手前で止められてメールが未送信になります。
   Access を付けるのは利用者がブラウザで開くホストだけです。

7. 最後に疎通を確かめます。

.. code-block:: powershell

   curl.exe https://mail-hook.eventkreater.com/health

.. list-table::
   :header-rows: 1
   :widths: 46 54

   * - 確かめること
     - 期待
   * - ``GET /health``
     - ``{"ok":true}``。ホストと証明書と Worker がそろっている
   * - 誤ったトークンのパスへ POST する
     - 404
   * - ``ALLOWED_RECIPIENTS`` に無い宛先へ POST する
     - 403
   * - Resend の鍵を変えて POST する
     - 502

``502`` が返るときは、Worker のログに上流の状態番号が出ます（``UPSTREAM_STATUS_...``）。

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - 上流
     - 原因と直し方
   * - ``401``
     - ``RESEND_API_KEY`` が無効。Resend で鍵を作り直し、``wrangler secret put`` で入れ直す
   * - ``422``
     - ほぼ ``RESEND_API_KEY`` の所属違い。Resend の鍵はチーム単位で、別チームの鍵では ``from`` のドメインが見えず 422 になる。宛先を変えても同じ結果になるので、まず鍵を疑う
   * - ``429``
     - 送信数の上限。Resend の Usage を見る

``422`` を切り分けるときは、同じ鍵で ``GET https://api.resend.com/domains`` を叩き、``send.eventkreater.com`` が
``verified`` で見えるか確かめます。見えなければ、その鍵は別のチームのものです。送信ドメインの検証そのものは
Resend のダッシュボードで状態を確認できます。

.. code-block:: powershell

   # 送信ドメインがこの鍵で見えるか（見えなければ鍵の所属違い）
   curl.exe https://api.resend.com/domains -H "Authorization: Bearer $env:RESEND_API_KEY"

   # Worker のログを流したまま、別の端末から 1 通送る
   cd infra\mail-webhook
   npx wrangler tail --config wrangler.prod.toml

SMS 配送（Twilio と Worker）
^^^^^^^^^^^^^^^^^^^^^^^^^^^^

.. note::

   この節も手順 2.3 の前に入ります。番号は付けていません。

電話番号の確認コードは、アプリが ``SMS_WEBHOOK_URL`` へ ``{ "to": "+819012345678", "body": "..." }`` を
POST するだけで、Twilio は呼びません。受け口の Cloudflare Worker（``infra/sms-webhook``）が Twilio の
Messages API へ転送します。メール中継と同じ形で、Twilio の鍵は Worker の秘密に閉じ、Fly には URL だけを置きます。

.. code-block:: text

   event-creater-web（deliverSms）
     ↓ POST { to, body } を認証ヘッダなしで送る
   sms-hook.eventkreater.com（Worker）
     ↓ POST /Accounts/{SID}/Messages.json を Basic 認証で送る
   Twilio（国際ゲートウェイ・送信元は英数字 Sender ID）
     ↓
   利用者の携帯

staging は別の Worker と別のホスト（``sms-hook-stg.eventkreater.com``）を使います。差分は :doc:`staging` の 7 にあります。

1. Twilio のアカウントを用意します。試用（Trial）のままでは英数字 Sender ID を使えないため、先に Upgrade（クレジットカードの登録）を済ませます。ダッシュボードの Account Info にある Account SID と Auth Token を控えます。**Upgrade だけでは足りません。** Trust Hub の一次コンプライアンスプロファイル（KYC）の承認も要ります。未承認のあいだは Messages API が ``401`` で ``{"code":20003,"message":"Primary compliance profile is not approved. ... complete the KYC process in Trust Hub"}`` を返し、アプリには ``502`` が返ります。審査は最大 48 時間で、政府発行の写真付き ID と自撮りが要ります（`Trust Hub のプロファイル <https://www.twilio.com/docs/trust-hub/profiles>`_ と `エラー 20003 <https://www.twilio.com/docs/api/errors/20003>`_）。

   **Individual プロファイルでも日本向けの英数字 Sender ID は送れました。** 公式の一覧では英数字 Sender ID が Business プロファイルの機能として挙がっていますが、2026-11-04 に Individual（個人）の承認で ``SMS_FROM=EVENTKRTR`` が通り、``status: delivered`` まで到達しています。法人格や屋号が無くても、まず Individual で試して構いません。弾かれた場合の逃げ道は 2 つです。Business プロファイルを ``Company type: Sole Proprietorship`` と ``Business registration ID type: Other`` で作る（法人番号は要りません）か、Twilio の番号を買って ``SMS_FROM`` を数値に変える（日本では ``010`` が頭に付いて表示されます）。
2. 送信元は **英数字 Sender ID** にします。``SMS_FROM`` は 3〜11 文字で、英字を 1 文字以上含む ASCII です（例 ``EVENTKRTR``）。日本の番号を買う必要はなく、番号の維持費もかかりません。
3. 国際ゲートウェイは登録不要で、すぐ使えます。代わりに片方向で、利用者からの返信は受け取れません。日本のガイドラインで国内ゲートウェイを使う場合は事業者ごとの登録が要り、審査に約 5 週間かかります。国内ゲートウェイは送信元 ID を保存しないため番号としては残らず、使うときは Twilio の営業へ問い合わせます。
4. 宛先は E.164（``+819012345678``）です。アプリの ``toE164`` が国内形式をこの形へ直してから POST します。本文に電話番号を書かないでください（Twilio の日本向けガイドラインで禁止です）。オプトインとオプトアウトの案内は本文に残します。
5. 料金は日本向けで 1 通 $0.089（セグメント単位）です。日本語は 70 文字で 1 セグメントなので、70 文字を超えると 2 通ぶん課金されます。いまの確認コードは 30 文字ほどで 1 セグメントに収まります。
6. Worker の秘密を 5 つ入れます。初回だけ手元で入れてからデプロイします。ふだんのデプロイは CI（``.github/workflows/deploy-env.yml`` の ``sms`` ジョブ）が上げます。

.. code-block:: powershell

   cd infra\sms-webhook
   npx wrangler secret put TWILIO_ACCOUNT_SID  --config wrangler.prod.toml
   npx wrangler secret put TWILIO_AUTH_TOKEN   --config wrangler.prod.toml
   npx wrangler secret put SMS_FROM            --config wrangler.prod.toml
   npx wrangler secret put WEBHOOK_TOKEN       --config wrangler.prod.toml
   npx wrangler secret put ALLOWED_RECIPIENTS  --config wrangler.prod.toml
   npx wrangler deploy --config wrangler.prod.toml

秘密の値は次のとおりです。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 名前
     - 値
   * - ``TWILIO_ACCOUNT_SID``
     - Twilio の Account SID。Basic 認証のユーザー名になる
   * - ``TWILIO_AUTH_TOKEN``
     - Twilio の Auth Token。Basic 認証のパスワードになる
   * - ``SMS_FROM``
     - 英数字 Sender ID（``EVENTKRTR``）。3〜11 文字、英字を 1 文字以上、ASCII のみ
   * - ``WEBHOOK_TOKEN``
     - アプリが URL のパスに載せる合言葉。一致しないパスは 404 です
   * - ``ALLOWED_RECIPIENTS``
     - ``*``。本番は参加者・主催者の任意の宛先へ送ります。空にすると全拒否です。staging は自分の番号だけにします

7. アプリの宛先を Worker に切り替えます。``SMS_WEBHOOK_URL`` は実行時の env なので再ビルドは要りません（``fly secrets set`` で Machine は再起動します）。

.. code-block:: powershell

   fly secrets set SMS_WEBHOOK_URL="https://sms-hook.eventkreater.com/<WEBHOOK_TOKEN>" --app event-creater-web

.. warning::

   ``sms-hook.eventkreater.com`` に Cloudflare Access を付けないでください。Access はブラウザのログインを要求し、
   ``deliverSms`` は認証ヘッダを付けられないため、Worker の手前で止められてコードが届きません。
   Access を付けるのは利用者がブラウザで開くホストだけです。

8. 最後に疎通を確かめます。

.. code-block:: powershell

   curl.exe https://sms-hook.eventkreater.com/health

.. list-table::
   :header-rows: 1
   :widths: 22 78

   * - 返る値
     - 原因と直し方
   * - ``401``
     - Twilio の ``TWILIO_ACCOUNT_SID`` / ``TWILIO_AUTH_TOKEN`` が無効。アプリには ``502`` で返り、Worker のログは ``UPSTREAM_STATUS_401`` になる
   * - ``403``
     - ``ALLOWED_RECIPIENTS`` に無い宛先。staging は自分の番号だけを入れる
   * - ``404``
     - ``WEBHOOK_TOKEN`` の不一致。``SMS_WEBHOOK_URL`` のパスと Worker の秘密をそろえる
   * - ``429``
     - Twilio のレート上限。少し待ってから送り直す
   * - ``502``
     - Twilio が受け付けない。番号の形式（E.164）か ``SMS_FROM`` の値（英数字 3〜11 文字、英字を 1 文字以上）を疑う

``502`` が返るときは、Worker のログに上流の状態番号と Twilio の ``code`` が出ます（``UPSTREAM_STATUS_...``）。
宛先と本文はログに出ません。

.. note::

   2026-11-04 時点の配備結果です。Cloudflare Worker は staging の ``event-creater-sms-stg``（設定は ``infra/sms-webhook/wrangler.toml``、custom domain は ``sms-hook-stg.eventkreater.com``）と、本番の ``event-creater-sms``（設定は ``infra/sms-webhook/wrangler.prod.toml``、custom domain は ``sms-hook.eventkreater.com``）を配備しました。秘密 5 つは ``wrangler secret bulk`` で投入し、どちらも ``GET /health`` が ``200`` で ``{"ok":true}`` を返しています。``WEBHOOK_TOKEN`` は本番と staging で別の値にしました（staging のトークンが漏れても本番の Worker は叩けません）。値はどちらもコミットせず、``.tmp-twilio.env`` / ``.tmp-twilio-prod.env`` の控えにだけ置いています。

   Fly の ``event-creater-web-stg`` と ``event-creater-web`` には ``SMS_WEBHOOK_URL`` を投入済みです。``fly ssh console -C "printenv SMS_WEBHOOK_URL"`` で反映を、``fly checks list`` で passing を確認しています。これまで本番は ``SMS_WEBHOOK_URL`` が空で、``src/lib/sms.ts`` が ``NODE_ENV=production`` のとき本文をログに出さないため、電話番号の確認コードが誰にも届かず新規登録を完了できませんでした。

   同日、Twilio の Trust Hub の一次コンプライアンスプロファイル（Individual）が ``twilio-approved`` になったあと、Worker の URL へ直接 POST して実送信を確かめました。staging と本番の両方が ``202`` を返し、``GET /2010-04-01/Accounts/{SID}/Messages.json`` で ``from: EVENTKRTR`` / ``status: delivered`` / ``num_segments: 1`` を確認しています（``$0.089`` が残高から引かれます）。承認前は Messages API が ``401`` と ``{"code":20003,"message":"Primary compliance profile is not approved. ..."}`` を返し、Worker は ``UPSTREAM_STATUS_401_CODE_20003`` → ``UPSTREAM_REJECTED``、アプリには ``502``、``fly logs`` には ``[sms] 送信に失敗しました (HTTP 502)`` を出していました。承認後はコード変更も秘密の入れ直しも要りません。

   画面からの受け入れ確認は、本番の ``https://eventkreater.com/`` で 2026-11-04 に通しました。会員登録 → 電話番号の確認 → ログインまで到達し、``users`` テーブルに ``phone_e164 = +818073062345`` と ``phone_verified_at`` を持つ行が作られています（``fly logs`` に ``[sms]`` の警告は出ていません）。staging は Cloudflare Access の One-time PIN を通す必要があるため、運用者が手で行います。

2.3 Cloudflare Tunnel アプリを作る
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Cloudflare Tunnel を受ける ``cloudflared`` を、Fly の 3 つ目のアプリとして動かします。コードを持たないので ``fly launch`` は使わず、``fly.toml`` を書いてデプロイします。``fly.toml`` はリポジトリに置かず、作業用のフォルダで作ります。

.. code-block:: powershell

   mkdir event-creater-tunnel
   cd event-creater-tunnel
   fly apps create event-creater-tunnel

``fly.toml`` は次の内容にします。``[build] image`` で公式イメージをそのまま使い、``[processes]`` で ``tunnel`` サブコマンドを起動します。

.. code-block:: toml

   app = "event-creater-tunnel"
   primary_region = "nrt"

   [build]
     image = "cloudflare/cloudflared:latest"

   [processes]
     app = "tunnel --no-autoupdate run"

   [[vm]]
     size = "shared-cpu-1x"
     memory = "256mb"

.. note::

   ``image`` は ``cloudflare/cloudflare-docker/cloudflared`` ではなく ``cloudflare/cloudflared:latest`` です。前者の名前では Fly から引けないため、Docker Hub の公式イメージを使います。
   ``--no-autoupdate`` は、コンテナの中で自分を更新しようとして再起動を繰り返すのを避けるためです。更新はイメージを差し替えて行います。

Cloudflare 側で Tunnel を作ります。

1. Zero Trust のダッシュボードで **Networks → Tunnels** を開き、**Create a tunnel** を選びます。種類は **Cloudflared** です。Zero Trust の組織（team domain）がまだ無ければ、この時点で作ります（Access でも同じ組織を使います）。
2. トンネルに名前を付けます（本番は ``event-creater-tunnel``）。作成後に出るトークン（``eyJ...``）を控えます。トークンは ``fly secrets set`` にだけ使い、リポジトリには置きません。
3. **Public Hostname** を足します。サブドメインを空、ドメインを ``eventkreater.com``、**Service** を ``HTTP``、URL を ``event-creater-web.internal:3012`` にします。保存すると、同じ名前の ``CNAME``（``<tunnel-id>.cfargotunnel.com``）も自動で作られます。
4. 控えたトークンを Fly の秘密に入れてデプロイします。

.. code-block:: powershell

   fly secrets set TUNNEL_TOKEN="eyJ..."
   fly deploy

   fly status --app event-creater-tunnel
   fly logs --app event-creater-tunnel

.. note::

   ``cloudflared`` は ``TUNNEL_TOKEN`` という名前の環境変数を自分で読みます。引数で渡す必要はありません。
   ``fly logs`` に認証エラーが出る場合は、Cloudflare 側でトンネルを消したか、トークンを発行し直したかです。作り直したら ``fly secrets set`` からやり直します。

.. important::

   Public Hostname を足しただけでは 503 が返ることがあります。そのときは **Ingress（Public Hostname の一覧）が本当に保存されているか** を先に見てください。
   ダッシュボードで「追加したつもり」のまま保存されていないと、tunnel 自体は ``connected`` なのに振り分け先が無く、``http_status:404`` ではなく 503 になります。
   API で直すなら ``PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations`` に次の形を送ります（最後の 1 行が必須です）。

   .. code-block:: json

      {
        "config": {
          "ingress": [
            { "hostname": "eventkreater.com", "service": "http://event-creater-web.internal:3012" },
            { "hostname": "staging.eventkreater.com", "service": "http://event-creater-web-stg.internal:3012" },
            { "service": "http_status:404" }
          ]
        }
      }

   ``originRequest.connectTimeout`` などを足すときは数値（文字列ではない）で送ります。文字列だと Cloudflare 側で設定ごと弾かれます。
   この API は Cloudflare の API トークンか、ダッシュボードのログインセッションで叩けます。``cloudflared tunnel login`` が置く ``cert.pem`` は Argo Tunnel 用のトークンで、API の mTLS 証明書ではないため使えません。

   このアプリは公開ポートもボリュームも持たず、載っているのは ``cloudflared`` だけです。
   Public Hostname の向き先は ``http://event-creater-web.internal:3012`` にします。6PN の中は TLS ではないので ``https`` にしないでください。``fly ips`` で IP を足す必要もありません。

検証環境（staging）は、同じ骨格を ``-stg`` のアプリ名で並べます。web は ``event-creater-web-stg``、flyer は ``event-creater-flyer-stg`` で、Neon も Stripe も本番とは別に用意します。差分だけを :doc:`staging` にまとめてあります。

tunnel は本番と staging で ``event-creater-tunnel`` の 1 つを共用し、``staging.eventkreater.com`` → ``http://event-creater-web-stg.internal:3012`` の Public Hostname を足すだけで staging 用のアプリは作りません（:doc:`staging` の 2.4）。Cloudflare Tunnel は 1 つで複数の Public Hostname を持てますが、1 つの tunnel を共有すると、その tunnel の障害で本番と staging が同時に止まります。切り分けを優先するなら tunnel アプリを分ける選択肢もありますが、いまはアプリを増やさない方針です。

staging のホスト名は Cloudflare Access で守ります。組織の **Access → Applications** に self-hosted アプリを 1 つ作り、ドメインを ``staging.eventkreater.com``、ポリシーを「許可したメールアドレスだけ」にします。Access は IdP が 1 つも無いと「ログイン方法がありません」で止まるので、**Settings → Authentication** で One-time PIN を有効にしてからアプリの ``allowed_idps`` に入れます。

2.4 GitHub Actions のデプロイを有効にする
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

デプロイは 2 本のワークフローで行います。``.github/workflows/deploy.yml`` が入口で、「どちらの環境へ、どの commit を、どの順で出すか」だけを決めます。中身（``migrate`` → ``flyer`` → ``web`` と ``mail`` の 4 ジョブ）は ``.github/workflows/deploy-env.yml`` にあり、環境名と ref を受け取って 1 回だけ流します。staging と production で中身が同じ（違うのは environment secrets と ``fly*.toml`` だけ）なので、ジョブを 2 組に複製していません。

きっかけは 2 つです。

.. list-table::
   :header-rows: 1
   :widths: 24 76

   * - きっかけ
     - 流れ
  * - ``main`` の CI が緑で終わったとき（``workflow_run``）
     - staging → production の順。staging が赤なら production は走らない。``push`` で起動した CI だけが対象で、CI を手で流し直しても動かない
  * - 手で流すとき（``workflow_dispatch``）
     - 選んだ環境だけ。``staging`` を選べば staging だけ、``production`` を選べば production だけ

どちらの経路でも ``migrate`` → ``flyer`` → ``web`` の順に直列で流れ、マイグレーションが失敗すればアプリは上がりません。web は flyer の 6PN を引くので、flyer を先に上げます。メール中継の ``mail`` は DB を読まないので、この列とは別に並行で流れます。

``workflow_run`` は ``paths`` で絞れないため、``docs/`` だけの変更でも連鎖は動きます。CI の対象判定（``scripts/ci-scope.mjs``）はデプロイには効きません。ビルドは走りますが、当てるマイグレーションが無ければ ``migrate`` は何もせずに通ります。

``main`` の CI から流れたとき、production は GitHub Environment ``production`` の **Required reviewers** で止まるまで進みません。staging は承認なしで先に上がるので、staging を見てから承認できます。承認は環境を指すジョブごとに求められるため、``deploy-env.yml`` の 4 ジョブぶんまとめて 1 回承認してください（GitHub の **Review pending deployments** でまとめられます）。

このワークフローは、リポジトリ変数 ``DEPLOY_ENABLED`` が ``true`` のときだけ動きます。Fly のアプリも environment secrets も無い段階で main に入っても、CI 成功のたびに赤い実行が積まれないようにするためです。未設定のときは skipped で終わり、main は緑のままです。

1. GitHub の **Settings → Environments** で ``staging`` と ``production`` を作ります。``production`` には **Required reviewers** を付けます（CI が緑でも、そのまま本番へ出さないための人手の 1 回です）。
2. 両方の environment に secrets を 2 つ入れます。``FLY_API_TOKEN`` は ``fly tokens create org`` で作ります。``DATABASE_URL_DIRECT`` は Neon の Direct 接続文字列です（プール済みではありません。``prisma/schema.prisma`` が ``directUrl`` を持たないためです）。
3. 任意で、``staging`` の environment に ``CF_ACCESS_CLIENT_ID`` と ``CF_ACCESS_CLIENT_SECRET`` を足します。staging のホストは Cloudflare Access で守っているので、外から疎通を確かめるには Service Token が要ります。入れると、staging の web を上げたあとに ``/api/v1/public/pricing`` を 200 が返るまで試し、通らなければ production へ進みません。未設定ならこの確認は飛ばします（デプロイ自体は通ります）。同じく任意で、両方の environment に ``CLOUDFLARE_API_TOKEN`` と ``CLOUDFLARE_ACCOUNT_ID`` を足すと、``mail`` ジョブがメール中継を CI から上げます。未設定ならジョブを飛ばします。

   ``CLOUDFLARE_API_TOKEN`` は Cloudflare の **My Profile → API Tokens → Create Token** で Custom token として作り、次の権限を付けます。

   - ``Account`` / ``Workers Scripts`` / ``Edit``（**Account スコープ**の権限です。Zone 側に付けても Worker を読めず、``deploy`` が ``No access to the specified resource.`` で落ちます）
   - ``Zone`` / ``Workers Routes`` / ``Edit``
   - ``Zone`` / ``Zone`` / ``Read``
   - Account Resources は対象のアカウント、Zone Resources は ``eventkreater.com`` だけに絞ります

   ``CLOUDFLARE_ACCOUNT_ID`` はダッシュボードの **Account ID** です。TTL は運用に合わせて延ばしてください（既定の 1 週間だと、切れた朝に ``mail`` ジョブが黙って落ちます）。
4. リポジトリの **Settings → Variables → Actions** で ``DEPLOY_ENABLED`` を ``true`` にします。最初の 1 回は ``workflow_dispatch`` で staging を選んで流し、通ってから production を承認すると安全です。2 回目以降は ``main`` の CI 成功から staging → production の順に流れます。

.. note::

   このリポジトリでは 2026-11-03 に environments・secrets・``DEPLOY_ENABLED`` を設定済みです。``production`` の承認者は 1 名で、
   ``workflow_dispatch`` の staging と、``main`` の CI からの production の両方が success で終わることを確かめています。
   デプロイの成否は **Actions の ``Deploy``** で見てください（``fly deploy`` を手で叩いたときと違い、承認待ちのあいだは job が止まります）。

   ``main`` の CI から staging → production の順に流す形は、同じ 2026-11-03 に後から入れました。
   その日のうちに、``main`` の CI 成功から 1 本の ``Deploy`` で
   ``staging / migrate`` → ``staging / flyer`` → ``staging / web`` が success で終わり、続いて
   ``production / migrate`` が承認待ちで止まることを確かめています（commit ``4ad8cef``）。
   承認は 1 回で、``production`` の 3 ジョブすべてに効きました。

   承認をしないまま次のマージが来ると、承認待ちの実行が積み上がります（``cancel-in-progress: false`` のため）。
   古い実行を誤って承認しないよう、出さないと決めた実行は Actions から止めてください。

``NEXT_PUBLIC_APP_URL`` と ``NEXT_PUBLIC_GA_MEASUREMENT_ID`` はビルド時に焼き込まれるので、値は各 ``fly*.toml`` の ``[build.args]`` が持ちます。ワークフローからは渡しません（2 か所に書くと、片方だけ直したときに静かにずれます）。

3. Cloudflare を向ける
----------------------

1. ドメインのネームサーバーを Cloudflare に向けます。
2. 公開は **Tunnel の Public Hostname** で行います（手順 2.3）。``CNAME`` を ``event-creater-web.fly.dev`` に向ける Proxy（オレンジ雲）のレコードは作りません。web が公開ポートを持たないため、CNAME では届きません。
3. SSL/TLS の暗号化モードを **Full (strict)** にします。Cloudflare から ``cloudflared`` までが TLS で、その先の 6PN は Fly の内部網です。
4. 次のルールを入れます。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 設定
     - 内容
   * - Cache Rules
     - ``/api/*`` はキャッシュしない（``Cache eligibility: Bypass cache``）。出欠と決済が混ざります。``/_next/static/*`` はアプリが ``Cache-Control: public, max-age=31536000, immutable`` を返すので、追加のルールは要りません
   * - WAF
     - 管理画面 ``/console/*`` とメール中継 ``mail-hook.eventkreater.com``、SMS 中継 ``sms-hook.eventkreater.com`` を、1 本のレート制限でまとめて見ます（無料枠は 1 ゾーン 1 本まで。2 本目は作れません。式としきい値は手順 2.2 のメール配送にあります）。無料枠は 10 秒の窓しか選べません。必要なら IP 制限も足す

.. note::

   このゾーンでは、2026-11-03 時点で **Full (strict)**・``/api/*`` の Bypass・``/console/*`` と ``mail-hook.eventkreater.com`` をまとめたレート制限まで入れています。2026-11-04 に、同じ 1 本の式へ ``sms-hook.eventkreater.com`` と ``sms-hook-stg.eventkreater.com`` を OR で足しました。ルールは 1 本のままで、しきい値は ``20 requests / 10 seconds``、characteristics は ``ip.src`` と ``cf.colo.id``、``mitigation_timeout`` は 10 秒、action は ``block`` のまま変えていません（2 本目は作れません）。
   実測では ``/api/v1/public/pricing`` が ``cf-cache-status: DYNAMIC``、``/_next/static/*.css`` が ``immutable`` でした。

   ``src/modules/auth/lib/cookies.ts`` の ``clientIp()`` は ``cf-connecting-ip`` → ``fly-client-ip`` → ``x-real-ip`` の順に見て、最後に ``x-forwarded-for`` の右端を使います。
   以前は **Cloudflare を迂回して ``*.fly.dev`` を直接叩かれるとこの前提が崩れる** ことが課題でしたが、Cloudflare Tunnel を別アプリ（``event-creater-tunnel``）で動かして web の公開ポートを消したため、オリジンへ到達する経路が無くなり解消しています。
   ``cf-connecting-ip`` を最優先で見る前提はそのままです。Tunnel 以外の到達経路（``fly ips`` での IP 追加、``[http_service]`` の復活）を作らないでください。

4. Stripe を本番に向ける
------------------------

1. Stripe の Dashboard で本番モードに切り替え、Price を 3 つ作ります（月額で8件まで公開プラン 980 円、公開し放題 2,980 円、単発 299 円）。
2. Webhook のエンドポイントを ``https://eventkreater.com/api/v1/webhooks/stripe`` にします。
3. 受け取るイベントは、テストモードで使ったものと同じにします。署名シークレットを ``STRIPE_WEBHOOK_SECRET`` に入れます。
4. 返金は Dashboard から行います。アプリに返金の口はありません。

.. note::

   価格キャンペーンの 0 円販売はアプリ側の設定で切り替えます。詳しくは :doc:`pricing_campaign_requirements` を見てください。

5. デプロイ後の確認
-------------------

上から順に、失敗したらそこで止めます。

.. code-block:: powershell

   # 1. flyer が起きているか（公開していないので flyctl 経由）
   fly logs --app event-creater-flyer
   fly checks list --app event-creater-flyer

   # 2. web が DB に繋がっているか
   fly logs --app event-creater-web

   # 3. Cloudflare 経由の公開エンドポイント
   curl.exe -s https://eventkreater.com/api/v1/public/pricing

   # 4. ヘッダーが Cloudflare 由来か（cf-ray が付く）
   curl.exe -sI https://eventkreater.com/

   # 5. 6PN の名前解決（web のコンテナの中から見る）
   fly ssh console --app event-creater-web -C "getent hosts event-creater-flyer.internal"

   # 6. staging は Access に止められているか（302 が正しい）
   curl.exe -s -o NUL -w "%{http_code}`n" https://staging.eventkreater.com/

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - 見るところ
     - 期待
   * - ``/api/v1/public/pricing``
     - 200 と価格の JSON。500 なら ``DATABASE_URL`` かマイグレーション漏れ
   * - ``fly logs`` の web
     - ``prisma`` の接続エラーが出ていない
   * - ``getent hosts event-creater-flyer.internal``
     - ``fdaa:...`` が返る。引けないなら同じ ``nrt`` に居るか、アプリ名を確かめる
   * - ``https://staging.eventkreater.com/``
     - 302 で Access のログインへ。200 が返るなら Access のアプリが外れている
   * - ログイン
     - ``/console/login`` から入れる。Cookie が ``__Host-`` で始まる
   * - チラシ生成
     - 候補が出て、画像が返る。500 なら flyer の ``OPENAI_API_KEY`` とフォント
   * - 音声の文字起こし
     - ``POST /api/v1/voice/transcriptions`` が 200。``model`` が ``gpt-4o-mini-transcribe`` ならモックではない
   * - Stripe
     - テストカードで 1 件通し、Webhook が 200 で返っている

チラシ画像が 500 になる場合は、ボリュームの所有者を疑ってください（手順 2.2 の ``chown``）。

6. 更新と切り戻し
-----------------

ふだんの更新は、作業ブランチを ``main`` へマージするだけです。CI が緑で終わると ``Deploy`` が staging → production の順に流れます（2.4）。承認を待たずに切り分けたいときだけ、下の手作業を使います。

.. code-block:: powershell

   # 手で出すとき。マイグレーションを先に流す
   $env:DATABASE_URL = "postgresql://...direct..."
   npx prisma migrate deploy
   fly deploy --app event-creater-web
   fly deploy --app event-creater-flyer

   # リリース一覧と切り戻し
   fly releases --app event-creater-web
   fly deploy --app event-creater-web --image registry.fly.io/event-creater-web:<tag>

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - 場面
     - すること
   * - マイグレーションだけ失敗した
     - ``fly deploy`` はまだ実行していない。``prisma migrate status`` でどこまで当たったかを見て、手で直す
   * - 新イメージが起動しない
     - ``fly logs`` を見て、前のイメージタグへ ``--image`` で戻す
   * - DB の変更が入って戻せない
     - マイグレーションは前方のみです。戻すときは打ち消しのマイグレーションを足します

7. いまの制約
-------------

本番構成で先に知っておくべき制約です。いずれもコード側の変更が要ります。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 制約
     - 内容と、外すときにやること
   * - チラシ画像がローカルディスク
     - ``src/modules/flyers/lib/flyer.ts`` は ``process.cwd()/storage/flyers`` に書きます。**web は 1 台で運用してください。** 2 台にすると、A が保存した画像を B が返せません。R2 へ移すのが次の一歩です
   * - プロフィールのアイコンもローカルディスク
     - ``src/lib/image-assets.ts`` は ``process.cwd()/storage/images`` に WebP を書きます。チラシと同じく単一インスタンス前提です（``Dockerfile`` の ``mkdir`` と ``.gitignore`` に追加済み）。移すときは保存と配信の 2 か所だけで、``image_assets`` の行はそのまま使えます
   * - R2 は未実装
     - チラシ画像とアイコンは Fly ボリューム（``web_storage`` → ``/app/storage``）に置いています。コードはまだ R2 を読み書きしないため、構成図にも入れていません
   * - チラシ候補もローカルディスク
     - flyer 側の ``CANDIDATE_DIR`` はボリュームです。台数を増やすと候補の見え方がずれます
   * - ログイン試行の記録は DB
     - ``AuthAttempt`` に貯めるので台数を増やしても効きます。一方、チラシとアイコンのアップロード回数制限はプロセス内の ``Map``（``src/lib/upload-limit.ts``）なので、台数ごとに別々です
