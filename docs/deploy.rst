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

.. warning::

   この構成はまだ本番で通していません。ローカルで ``docker compose -f docker-compose.prod.yml`` の相当構成（standalone イメージ + Flyer + PostgreSQL）は通していますが、Cloudflare Tunnel・Fly.io・Neon を組み合わせた状態では未検証です。
   このページは Cloudflare Tunnel を使う版へ更新した時点で、``fly.toml`` と同時に書き直したものです。公開経路が Tunnel に変わったぶん、実際に通すときは手順 5 の確認を上から順にやり直してください。
   ``fly.toml`` の値は Fly.io の設定リファレンスに合わせて書いたもので、``fly config validate`` での確認を前提にします。

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
       NEXT_PUBLIC_APP_URL = "https://example.com"
       # 任意。GA4 の測定 ID。空なら計測しない。
       NEXT_PUBLIC_GA_MEASUREMENT_ID = ""
       # APP_ENV（staging の noindex 判定）もビルド時に評価されるため、ここで渡します。
       APP_ENV = "production"

   [env]
     NODE_ENV = "production"
     PORT = "3012"
     FLYER_API_URL = "http://event-creater-flyer.internal:8000"
     # ビルド引数と同じ値。実行時の絶対 URL にも使う。
     NEXT_PUBLIC_APP_URL = "https://example.com"
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

   ``APP_ENV`` も ``[build.args]`` と ``[env]`` の両方に置きます。``next.config.mjs`` の ``headers()`` はビルド時に評価され、``APP_ENV`` が ``staging`` のときだけ ``X-Robots-Tag: noindex, nofollow`` を付けます。staging へ出すときは ``"staging"`` を渡してください（``robots.ts`` が実行時に読むぶんは ``[env]`` 側です）。理由は :doc:`staging` にまとめてあります。

.. important::

   ``NEXT_PUBLIC_APP_URL`` と ``NEXT_PUBLIC_GA_MEASUREMENT_ID`` は **ビルド時に埋め込まれます**。値を変えたら ``fly deploy`` し直してください。
   シークレットとして ``fly secrets set`` しても、既にビルドされた JS は変わりません。

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
     STRIPE_PRICE_ID_MONTHLY_8="price_..." `
     STRIPE_PRICE_ID_UNLIMITED="price_..." `
     STRIPE_PRICE_ID_ONE_TIME="price_..." `
     GOOGLE_CLIENT_ID="..." `
     GOOGLE_CLIENT_SECRET="..." `
     MAIL_WEBHOOK_URL="https://..." `
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

1. Zero Trust のダッシュボードで **Networks → Tunnels** を開き、**Create a tunnel** を選びます。種類は **Cloudflared** です。
2. トンネルに名前を付けます（例 ``event-creater``）。作成後に出るトークン（``eyJ...``）を控えます。トークンは ``fly secrets set`` にだけ使い、リポジトリには置きません。
3. **Public Hostname** を 1 つ足します。サブドメインとドメインを選び、**Service** を ``HTTP``、URL を ``event-creater-web.internal:3012`` にします。
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

   このアプリは公開ポートもボリュームも持たず、載っているのは ``cloudflared`` だけです。
   Public Hostname の向き先は ``http://event-creater-web.internal:3012`` にします。6PN の中は TLS ではないので ``https`` にしないでください。``fly ips`` で IP を足す必要もありません。

検証環境（staging）は、同じ骨格を ``-stg`` のアプリ名で並べます。web は ``event-creater-web-stg``、flyer は ``event-creater-flyer-stg`` で、Neon も Stripe も本番とは別に用意します。差分だけを :doc:`staging` にまとめてあります。

tunnel は本番と staging で ``event-creater-tunnel`` の 1 つを共用し、``staging.example.com`` → ``http://event-creater-web-stg.internal:3012`` の Public Hostname を足すだけで staging 用のアプリは作りません（:doc:`staging` の 2.3）。Cloudflare Tunnel は 1 つで複数の Public Hostname を持てますが、1 つの tunnel を共有すると、その tunnel の障害で本番と staging が同時に止まります。切り分けを優先するなら tunnel アプリを分ける選択肢もありますが、いまはアプリを増やさない方針です。

2.4 GitHub Actions のデプロイを有効にする
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

デプロイは ``.github/workflows/deploy.yml`` が行います。きっかけは 2 つで、``main`` の CI が緑で終わったとき（production）と、手で流すとき（``workflow_dispatch``。staging か production を選ぶ）です。``migrate`` → ``flyer`` → ``web`` の順に直列で流れ、マイグレーションが失敗すればアプリは上がりません。

このワークフローは、リポジトリ変数 ``DEPLOY_ENABLED`` が ``true`` のときだけ動きます。Fly のアプリも environment secrets も無い段階で main に入っても、CI 成功のたびに赤い実行が積まれないようにするためです。未設定のときは skipped で終わり、main は緑のままです。

1. GitHub の **Settings → Environments** で ``staging`` と ``production`` を作ります。``production`` には **Required reviewers** を付けます（CI が緑でも、そのまま本番へ出さないための人手の 1 回です）。
2. 両方の environment に secrets を 2 つ入れます。``FLY_API_TOKEN`` は ``fly tokens create org`` で作ります。``DATABASE_URL_DIRECT`` は Neon の Direct 接続文字列です（プール済みではありません。``prisma/schema.prisma`` が ``directUrl`` を持たないためです）。
3. リポジトリの **Settings → Variables → Actions** で ``DEPLOY_ENABLED`` を ``true`` にします。最初の 1 回は ``workflow_dispatch`` で staging を選んで流し、通ってから production を承認すると安全です。

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
     - ``/api/*`` はキャッシュしない（``Cache eligibility: Bypass cache``）。出欠と決済が混ざります
   * - Cache Rules
     - ``/_next/static/*`` と画像はキャッシュする
   * - WAF
     - 管理画面 ``/console/*`` にレート制限。必要なら IP 制限も足す

.. note::

   ``src/modules/auth/lib/cookies.ts`` の ``clientIp()`` は ``cf-connecting-ip`` → ``fly-client-ip`` → ``x-real-ip`` の順に見て、最後に ``x-forwarded-for`` の右端を使います。
   以前は **Cloudflare を迂回して ``*.fly.dev`` を直接叩かれるとこの前提が崩れる** ことが課題でしたが、Cloudflare Tunnel を別アプリ（``event-creater-tunnel``）で動かして web の公開ポートを消したため、オリジンへ到達する経路が無くなり解消しています。
   ``cf-connecting-ip`` を最優先で見る前提はそのままです。Tunnel 以外の到達経路（``fly ips`` での IP 追加、``[http_service]`` の復活）を作らないでください。

4. Stripe を本番に向ける
------------------------

1. Stripe の Dashboard で本番モードに切り替え、Price を 3 つ作ります（月額で8件まで公開プラン 980 円、公開し放題 2,980 円、単発 299 円）。
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
   * - プロフィールのアイコンもローカルディスク
     - ``src/lib/image-assets.ts`` は ``process.cwd()/storage/images`` に WebP を書きます。チラシと同じく単一インスタンス前提です（``Dockerfile`` の ``mkdir`` と ``.gitignore`` に追加済み）。移すときは保存と配信の 2 か所だけで、``image_assets`` の行はそのまま使えます
   * - R2 は未実装
     - チラシ画像とアイコンは Fly ボリューム（``web_storage`` → ``/app/storage``）に置いています。コードはまだ R2 を読み書きしないため、構成図にも入れていません
   * - チラシ候補もローカルディスク
     - flyer 側の ``CANDIDATE_DIR`` はボリュームです。台数を増やすと候補の見え方がずれます
   * - ログイン試行の記録は DB
     - ``AuthAttempt`` に貯めるので台数を増やしても効きます。一方、チラシとアイコンのアップロード回数制限はプロセス内の ``Map``（``src/lib/upload-limit.ts``）なので、台数ごとに別々です
