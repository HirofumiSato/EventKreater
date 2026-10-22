本番デプロイ
============

このページは、手元で動く状態から本番へ出すまでの手順です。対象は次の構成です。

.. code-block:: text

   利用者
     ↓
   Cloudflare（DNS・プロキシ・SSL・WAF）
     ↓
   Fly.io nrt
     ├─ event-creater-web    Next.js（standalone）
     └─ event-creater-flyer  FastAPI + Pillow + OpenAI
     ↓
   Neon（PostgreSQL）／ Fly ボリューム（チラシ画像）

ローカル起動は :doc:`local`、DB の操作は :doc:`database`、Stripe のテストは :doc:`stripe` を見てください。
このページは「本番でだけ違うこと」だけを書きます。

.. mermaid::

   flowchart TD
      U["利用者"] --> CF["Cloudflare<br/>DNS / Proxy / SSL / WAF"]
      CF --> WEB["Fly.io event-creater-web<br/>Next.js :3012"]
      WEB -->|"6PN http://...internal:8000"| FLYER["Fly.io event-creater-flyer<br/>FastAPI :8000"]
      WEB --> NEON["Neon PostgreSQL"]
      WEB --> VOL1["Fly ボリューム /app/storage"]
      FLYER --> VOL2["Fly ボリューム /data"]
      FLYER --> OPENAI["OpenAI API"]

.. warning::

   この手順はまだ本番で通していません。ローカルで ``docker compose -f docker-compose.prod.yml`` の相当構成（standalone イメージ + Flyer + PostgreSQL）は通していますが、Fly.io・Neon・Cloudflare の実環境では未検証です。
   とくに ``fly.toml`` の値は Fly.io の設定リファレンスに合わせて書いたもので、``fly config validate`` での確認を前提にしてください。

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
     - PostgreSQL 16。無料枠から始めます
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

2. Fly.io にアプリを 2 つ作る
-----------------------------

web と flyer は別アプリにします。flyer は公開ポートを持たず、web から 6PN（``<app>.internal``）でだけ呼びます。

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
     - 任意。既定は ``gpt-4o-mini`` と ``dall-e-3``
   * - ``STORAGE_DIR`` / ``CANDIDATE_DIR`` / ``FALLBACK_DIR``
     - 上の ``fly.toml`` で固定。ボリュームを外すと再起動で候補が消えます
   * - ``CANDIDATE_COUNT`` / ``CANDIDATE_TTL_SECONDS`` / ``TTL_SECONDS``
     - 任意。既定は 8 枚、3600 秒。``TTL_SECONDS`` は古い候補の掃除に使います

日本語フォントはイメージに ``fonts-noto-cjk`` として入っています。ローカルと同じく、無いと ``FontRenderError`` で全滅します。

2.2 web を作る
^^^^^^^^^^^^^^

.. code-block:: powershell

   cd ..\..
   fly launch --no-deploy --name event-creater-web --region nrt

``fly.toml`` は次の内容にします。``NEXT_PUBLIC_APP_URL`` はビルド時に焼き込まれるので、``[build.args]`` で渡します。

.. code-block:: toml

   app = "event-creater-web"
   primary_region = "nrt"

   [build]
     dockerfile = "Dockerfile"
     target = "runner"
     [build.args]
       NEXT_PUBLIC_APP_URL = "https://example.com"

   [env]
     NODE_ENV = "production"
     PORT = "3012"
     FLYER_API_URL = "http://event-creater-flyer.internal:8000"
     # ビルド引数と同じ値。実行時の絶対 URL にも使う。
     NEXT_PUBLIC_APP_URL = "https://example.com"

   [http_service]
     internal_port = 3012
     force_https = true
     auto_stop_machines = false
     auto_start_machines = false
     min_machines_running = 1

     [[http_service.checks]]
       method = "GET"
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

.. important::

   ``NEXT_PUBLIC_APP_URL`` は **ビルド時に埋め込まれます**。ドメインを変えたら ``fly deploy`` し直してください。
   シークレットとして ``fly secrets set`` しても、既にビルドされた JS は変わりません。

環境変数は次のとおりです。値は ``fly secrets set`` で入れます。

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
   * - ``FLYER_API_URL``
     - 必須
     - ``http://event-creater-flyer.internal:8000``
   * - ``STRIPE_SECRET_KEY``
     - 必須
     - ``sk_live_...``。``_live_`` を含むかどうかで本番判定をしています
   * - ``STRIPE_WEBHOOK_SECRET``
     - 必須
     - Webhook の署名シークレット。違うと ``/api/v1/webhooks/stripe`` が 400 を返します
   * - ``STRIPE_PRICE_ID_MONTHLY_980``
     - 必須
     - 月額の Price ID
   * - ``STRIPE_PRICE_ID_ONE_TIME``
     - 必須
     - 単発の Price ID
   * - ``GOOGLE_CLIENT_ID`` / ``GOOGLE_CLIENT_SECRET``
     - 任意
     - 両方そろったときだけ Google ログインが出ます
   * - ``MAIL_WEBHOOK_URL`` / ``SMS_WEBHOOK_URL``
     - 任意
     - 未設定なら送信はログだけになります（ローカルと同じ）
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
     STRIPE_PRICE_ID_MONTHLY_980="price_..." `
     STRIPE_PRICE_ID_ONE_TIME="price_..." `
     GOOGLE_CLIENT_ID="..." `
     GOOGLE_CLIENT_SECRET="..." `
     MAIL_WEBHOOK_URL="https://..." `
     BILLING_NOTICE_SECRET="..."

   fly deploy

.. important::

   コンテナは ``nextjs`` で動きます（uid 1001）。マウントしたボリュームのルートは root 所有で作られるため、
   初回だけ所有者を変えないとチラシ画像の保存に失敗します（``EACCES``）。

   .. code-block:: powershell

      fly ssh console -C "chown -R 1001:1001 /app/storage"
      fly ssh console -C "ls -ld /app/storage"

   ローカルの Docker で直したのと同じ問題です。詳細は :doc:`local` の「Docker で動かす」にあります。

3. Cloudflare を向ける
----------------------

1. ドメインのネームサーバーを Cloudflare に向けます。
2. ``CNAME`` を ``event-creater-web.fly.dev`` に向け、**Proxy status を Proxied（オレンジ雲）** にします。ルート（``@``）でも Cloudflare の CNAME flattening で使えます。IP を固定したいときは ``fly ips list`` の値を ``A`` レコードにします。
3. SSL/TLS の暗号化モードを **Full (strict)** にします。Fly.io 側は証明書を持っているので、これで通ります。
4. 次のルールを入れます。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 設定
     - 内容
   * - Cache Rules
     - ``/api/*`` はキャッシュしない（``Cache eligibility: Bypass cache``）。出欠と決済が混ざります
   * - Cache Rules
     - ``/_next/static/*`` と画像はキャッシュする
   * - WAF
     - 管理画面 ``/console/*`` にレート制限。必要なら IP 制限も足す
   * - Transform Rules
     - オリジン検証ヘッダーを付ける（下の注意を読んでください）

.. warning::

   ``src/modules/auth/lib/cookies.ts`` の ``clientIp()`` は ``cf-connecting-ip`` → ``fly-client-ip`` → ``x-real-ip`` の順に見て、最後に ``x-forwarded-for`` の右端を使います。
   **Cloudflare を迂回して ``*.fly.dev`` に直接叩かれると、この前提が崩れます。**
   今のコードはオリジン共有秘密を検証していないため、次のどちらかを必ず入れてください。

   * Cloudflare Tunnel（``cloudflared``）を Fly の別アプリとして動かし、web の公開ポートを消す。オリジンに到達する経路が無くなります
   * Cloudflare の Transform Rule で ``X-Origin-Secret`` を付け、Next.js の ``middleware.ts`` で照合する。**この検証は未実装です**

   未実装のまま公開すると、レート制限のキーを詐称できます。Cloudflare を付けただけで安全にはなりません。

4. Stripe を本番に向ける
------------------------

1. Stripe の Dashboard で本番モードに切り替え、Price を 2 つ作ります（月額 980 円、単発 299 円）。
2. Webhook のエンドポイントを ``https://example.com/api/v1/webhooks/stripe`` にします。
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
   curl.exe -s https://example.com/api/v1/public/pricing

   # 4. ヘッダーが Cloudflare 由来か（cf-ray が付く）
   curl.exe -sI https://example.com/

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - 見るところ
     - 期待
   * - ``/api/v1/public/pricing``
     - 200 と価格の JSON。500 なら ``DATABASE_URL`` かマイグレーション漏れ
   * - ``fly logs`` の web
     - ``prisma`` の接続エラーが出ていない
   * - ログイン
     - ``/console/login`` から入れる。Cookie が ``__Host-`` で始まる
   * - チラシ生成
     - 候補が出て、画像が返る。500 なら flyer の ``OPENAI_API_KEY`` とフォント
   * - Stripe
     - テストカードで 1 件通し、Webhook が 200 で返っている

チラシ画像が 500 になる場合は、ボリュームの所有者を疑ってください（手順 2.2 の ``chown``）。

6. 更新と切り戻し
-----------------

.. code-block:: powershell

   # 更新。マイグレーションを先に流す
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
   * - R2 は未実装
     - 構成図には入れていますが、コードはまだ R2 を読み書きしません。現状は Fly ボリュームです
   * - チラシ候補もローカルディスク
     - flyer 側の ``CANDIDATE_DIR`` はボリュームです。台数を増やすと候補の見え方がずれます
   * - ログイン試行の記録は DB
     - ``AuthAttempt`` に貯めるので台数を増やしても効きます。一方、チラシのアップロード回数制限はプロセス内の ``Map``（``src/modules/flyers/lib/upload-limit.ts``）なので、台数ごとに別々です
