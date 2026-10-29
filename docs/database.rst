データベース操作
================

このアプリのデータベースは PostgreSQL です。スキーマの正は ``prisma/schema.prisma`` で、適用済みの SQL は ``prisma/migrations/`` にあります。
初期マイグレーションは ``20261018171707_init_schema_with_billing`` です。

データベースの作成
------------------

ローカルの PostgreSQL に、データベース ``event_platform_billing`` を作ります。
ユーザーは手元のロールに合わせてください。 ``.env.example`` はパスワード無しのローカル接続を想定しています。

``psql`` に入って実行する例です。

.. code-block:: sql

   CREATE DATABASE event_platform_billing;

コマンドで作る場合は次です。

.. code-block:: powershell

   createdb event_platform_billing

``.env`` の ``DATABASE_URL`` は、そのデータベースを指します。パスワードが必要なときはユーザーとパスワードを含めます。

.. code-block:: text

   postgresql://USER:PASSWORD@localhost:5432/event_platform_billing?schema=public

接続できるかは ``psql`` で確認します。

.. code-block:: powershell

   psql "postgresql://USER@localhost:5432/event_platform_billing" -c "SELECT 1;"

``prisma db execute`` は SQL スクリプトの成否を返すコマンドで、 ``SELECT`` の結果セットは返しません。中身を見るときは ``psql`` か Prisma Studio を使います。

Prisma Client の生成
--------------------

``npm install`` の ``postinstall`` で ``prisma generate`` が実行されます。
スキーマを編集したあと、クライアントだけ作り直すときは次です。

.. code-block:: powershell

   npx prisma generate

生成物は ``node_modules/.prisma/client`` に置かれ、アプリは ``src/lib/prisma.ts`` の ``PrismaClient`` から使います。
開発時はプロセスをまたいでクライアントを再利用し、ログは ``error`` と ``warn`` です。

マイグレーション
----------------

開発中の適用と、新しいマイグレーションファイルの作成は次のコマンドです。
対話プロンプトが出ることがあるので、ローカルの端末で実行します。

.. code-block:: powershell

   npm run db:migrate

これは ``prisma migrate dev`` です。未適用の SQL を流し、スキーマとデータベースの差があれば新しいマイグレーションを作るよう促します。

状態の確認だけなら次です。

.. code-block:: powershell

   npx prisma migrate status

本番相当の環境へ、既存のマイグレーションだけを適用する場合は ``migrate dev`` を使わず、次を使います。
このコマンドは新しいマイグレーションを作りません。

.. code-block:: powershell

   npx prisma migrate deploy

スキーマを変えたときの流れは次です。

1. ``prisma/schema.prisma`` を編集する
2. ``npm run db:migrate`` を実行し、マイグレーション名を付ける
3. 生成された ``prisma/migrations/<timestamp>_<name>/migration.sql`` を確認する
4. ``npx prisma generate`` が自動で走らなければ実行する
5. 開発サーバーを再起動する

Prisma Studio
--------------

テーブルを GUI で見るには次を実行し、ブラウザで http://localhost:5555 を開きます。

.. code-block:: powershell

   npm run db:studio

終了は起動した端末で ``Ctrl+C`` です。

テーブル
--------

物理名は ``@@map`` のスネークケースです。アプリのモデル名とは違います。

.. list-table::
   :header-rows: 1
   :widths: 28 24 48

   * - テーブル
     - Prisma モデル
     - 役割
   * - ``users``
     - ``User``
     - 会員。メールは一意。確認済み電話番号（E.164）も一意。パスワードは bcrypt のハッシュ。 ``platform_role`` は ``MEMBER`` または ``ADMIN``
   * - ``signup_intents``
     - ``SignupIntent``
     - メール確認または Google 確認のあと、電話番号確認が終わるまでの登録意向。会員行はまだ無い
   * - ``phone_verification_codes``
     - ``PhoneVerificationCode``
     - SMS 確認コードのハッシュ。平文は保存しない
   * - ``user_usage_quotas``
     - ``UserUsageQuota``
     - 利用枠。会員 1 人に 1 行。電話番号確認で会員行を作るときに作られる
   * - ``billing_transactions``
     - ``BillingTransaction``
     - 単発または月額の決済記録。金額は整数の円。定価、割引額、適用キャンペーン、クーポン、冪等キーを持つ
   * - ``pricing_campaigns``
     - ``PricingCampaign``
     - 期間限定の価格キャンペーン。対象、割引率、開始と終了、優先度、版、停止日時
   * - ``pricing_campaign_coupons``
     - ``PricingCampaignCoupon``
     - 版・対象プラン・月数・種類ごとの Stripe クーポン ID
   * - ``pricing_campaign_audits``
     - ``PricingCampaignAudit``
     - 作成・編集・停止の監査ログ
   * - ``billing_notices``
     - ``BillingNotice``
     - 無料期間の終了前通知。 ``user_id``、種別、終了日時の組み合わせで一意
   * - ``stripe_webhook_events``
     - ``StripeWebhookEvent``
     - 処理済み Stripe イベント ID。重複適用を防ぐ
   * - ``flyer_assets``
     - ``FlyerAsset``
     - チラシ画像。イベントから任意で参照する
   * - ``events``
     - ``Event``
     - イベント本体。状態は ``DRAFT`` / ``PUBLISHED`` / ``CLOSED``
   * - ``event_organizers``
     - ``EventOrganizer``
     - 幹事。会員（ ``user_id`` ）またはゲストトークン
   * - ``participants``
     - ``Participant``
     - 出欠。状態は ``ATTENDING`` / ``DECLINED``
   * - ``event_locks``
     - ``EventLock``
     - 編集の排他ロック。期限は無く、解放または引き継ぎまで保持する
   * - ``event_invitations``
     - ``EventInvitation``
     - 共同幹事の招待コード

``user_usage_quotas`` の主な列は次です。

.. list-table::
   :header-rows: 1
   :widths: 32 68

   * - 列
     - 意味
   * - ``free_event_count``
     - 消費済みの無料回数。上限は 2
   * - ``paid_credits``
     - 未使用の単発チケット数
   * - ``subscription_status``
     - ``NONE`` / ``ACTIVE`` / ``PAST_DUE`` / ``CANCELED`` / ``INCOMPLETE``
   * - ``subscription_plan``
     - 加入中の定額プラン。 ``NONE`` / ``MONTHLY_8`` / ``UNLIMITED``
   * - ``current_period_end``
     - 定額プランの有効期限。 ``ACTIVE`` でも過去なら加入は効かない。 ``MONTHLY_8`` は公開中のイベントが 8 件まで、 ``UNLIMITED`` は公開中のイベント数を数えない
   * - ``stripe_customer_id``
     - Stripe Customer。一意
   * - ``stripe_subscription_id``
     - Stripe Subscription。一意
   * - ``pricing_campaign_id``
     - 適用中または最後に適用したキャンペーン
   * - ``discount_percent``
     - 適用中の割引率。100 は無料期間
   * - ``discount_ends_at``
     - 割引（無料期間）の終了日時。終了前通知の判定に使う

削除は外部キーの ``ON DELETE`` に従います。会員を消すと利用枠・取引・幹事関係は連鎖削除されます。
イベントを消すと幹事、出欠、ロック、招待が連鎖削除されます。チラシを消してもイベントは残り、 ``flyer_asset_id`` は NULL になります。

最初の管理者
------------

公開の会員登録では管理者を作れません。 ``users.platform_role`` の既定は ``MEMBER`` です。
ローカルで試すだけなら、 ``npm run db:seed`` が ``admin@example.com`` （ ``ADMIN`` ）を確認済みの電話番号付きで作ります。値は :doc:`local` にあります。
管理コンソール（ ``/console/login`` ）に入るには、パスワードを持ち、確認済み電話番号がある既存会員を ``ADMIN`` にします。
この URL は公開ナビとフッターに出しません。ログインはパスワードのあと、登録済み電話へのSMSで確認番号を入れます。

会員登録済みのメールアドレスを引数にします。

.. code-block:: powershell

   npm run admin:promote -- user@example.com

同じ結果を SQL で行う場合です。

.. code-block:: sql

   UPDATE users
   SET platform_role = 'ADMIN'
   WHERE email = 'user@example.com';

パスワードが空の会員（Google だけ）は、このコマンドがエラーになります。管理コンソールはメールとパスワードでしか入れないためです。
2人目以降は、ログイン後の会員一覧から権限を変更できます。自分の行は変更できません。

確認用 SQL
----------

``psql`` で ``event_platform_billing`` に接続して使います。メールアドレスは手元の会員に置き換えてください。

会員と利用枠を並べます。

.. code-block:: sql

   SELECT
     u.email,
     u.name,
     u.platform_role,
     q.free_event_count,
     q.paid_credits,
     q.subscription_status,
     q.current_period_end,
     q.stripe_customer_id
   FROM users AS u
   JOIN user_usage_quotas AS q ON q.user_id = u.id
   ORDER BY u.created_at DESC;

直近の決済です。

.. code-block:: sql

   SELECT
     u.email,
     t.payment_type,
     t.payment_status,
     t.amount,
     t.stripe_checkout_session_id,
     t.created_at
   FROM billing_transactions AS t
   JOIN users AS u ON u.id = t.user_id
   ORDER BY t.created_at DESC
   LIMIT 20;

公開中のイベントと出欠人数です。論理削除（ ``is_deleted`` ）は除きます。

.. code-block:: sql

   SELECT
     e.id,
     e.title,
     e.status,
     e.event_date,
     COUNT(p.id) FILTER (WHERE p.status = 'ATTENDING') AS attending,
     COUNT(p.id) FILTER (WHERE p.status = 'DECLINED') AS declined
   FROM events AS e
   LEFT JOIN participants AS p ON p.event_id = e.id
   WHERE e.is_deleted = FALSE
   GROUP BY e.id
   ORDER BY e.event_date;

期限切れの編集ロックはありません。ロックは保持者が解放するか、他の幹事が引き継ぐまで残ります。

.. code-block:: sql

   SELECT event_id, lock_holder_name, updated_at
   FROM event_locks
   ORDER BY updated_at;

ローカルでの利用枠の書き換え
----------------------------

決済を通さずに画面の分岐を見るときだけ、ローカルデータベースの利用枠を直接更新します。
本番のデータベースでは行いません。Stripe のテストカードで枠を付ける手順は :doc:`stripe` です。

無料 2 回を使い切った状態にします。

.. code-block:: sql

   UPDATE user_usage_quotas
   SET
     free_event_count = 2,
     paid_credits = 0,
     subscription_status = 'NONE',
     current_period_end = NULL
   WHERE user_id = (SELECT id FROM users WHERE email = 'you@example.com');

単発クレジットを 1 つ足します。

.. code-block:: sql

   UPDATE user_usage_quotas
   SET paid_credits = paid_credits + 1
   WHERE user_id = (SELECT id FROM users WHERE email = 'you@example.com');

月額で8件まで公開プランを、今から 30 日有効な状態にします。公開中のイベント数の数え方に専用の列はなく、 ``events`` の状態と開催日、 ``quota_source`` から数えます。

.. code-block:: sql

   UPDATE user_usage_quotas
   SET
     subscription_status = 'ACTIVE',
     subscription_plan = 'MONTHLY_8',
     current_period_end = NOW() + INTERVAL '30 days'
   WHERE user_id = (SELECT id FROM users WHERE email = 'you@example.com');

公開し放題にするときは ``subscription_plan`` を ``'UNLIMITED'`` にします。公開中のイベント数は数えません。

支払い失敗で作成できない状態にします。

.. code-block:: sql

   UPDATE user_usage_quotas
   SET subscription_status = 'PAST_DUE'
   WHERE user_id = (SELECT id FROM users WHERE email = 'you@example.com');

リセット
--------

ローカルのデータを消し、マイグレーションを最初から適用し直します。
このコマンドはデータベース内のデータを削除します。

.. code-block:: powershell

   npx prisma migrate reset

開発サーバーが接続したままだと失敗することがあります。先に ``next dev`` を止めてください。
確認プロンプトを省略するときは ``--force`` を付けます。

.. code-block:: powershell

   npx prisma migrate reset --force
