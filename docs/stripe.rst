Stripe のローカルテストと操作
========================================

このページは、手元で Stripe のテストモードを使う手順と、お金に触る操作の境界です。
起動と画面パスは :doc:`local`、チケットの確認 SQL は :doc:`database`、仕様の正は :doc:`billing_and_quota_system_requirements` です。

自動テストは Stripe の Dashboard も ``api.stripe.com`` も使いません。読む順は :doc:`testing/index` です。

.. warning::

   ローカルの ``STRIPE_SECRET_KEY`` は ``sk_test_`` で始まる値だけを置きます。
   ``sk_live_`` を ``.env`` に入れると、Checkout と Customer Portal は本番アカウントへ出ます。
   テストカードではなく、実カードから実課金されます。

お金に触る操作の境界
--------------------

このアプリから「カードからお金が動く」経路は、Stripe Hosted Checkout と Customer Portal と、Stripe Dashboard だけです。
管理画面と Webhook は課金も返金もしません。返金 API（ ``stripe.refunds.create`` ）はありません。

.. list-table::
   :header-rows: 1
   :widths: 36 28 36

   * - 操作
     - 実課金・返金
     - 何が変わるか
   * - ``POST /api/v1/billing/checkout/one-time``
     - テスト鍵ならテスト上の 299 円。 ``sk_live_`` なら実課金
     - Checkout セッションを作る。完了後に ``paid_credits`` を 1 増やす
   * - ``POST /api/v1/billing/checkout/subscription``
     - テスト鍵ならテスト上の初月 0 円（初月無料）または 980 円 / 2,980 円。 ``sk_live_`` なら初回課金と以後の自動更新
     - 8件まで公開プランまたは公開し放題プランを開始する。本文の ``plan`` で選ぶ。初月無料は ``trial_end`` で表す
   * - ``POST /api/v1/billing/portal``
     - 課金はしない。解約すると次回以降の請求が止まる（ live なら実契約）
     - カード変更と解約は Stripe 側。このアプリは URL を発行するだけ
   * - ``POST /api/v1/billing/checkout/verify``
     - しない。支払い済みセッションの確認
     - Webhook 遅延時に、同じ条件でチケットを付与する
   * - ``POST /api/v1/webhooks/stripe``
     - しない。Stripe へ課金も返金も打ち返さない
     - チケットと ``billing_transactions`` の反映。イベント ID の再送は無視する
   * - ``GET /api/v1/admin/payments`` と ``/console/payments``
     - しない。返金ボタンは無い
     - 決済履歴の検索と閲覧
   * - ``/console/pricing`` と ``POST /api/v1/admin/pricing-campaigns``
     - しない。販売価格の設定だけ
     - 期間キャンペーンの作成・編集・停止。既存購入者の金額は変えない
   * - ``POST /api/v1/billing/checkout/one-time`` （販売価格が 0 円）
     - しない。Stripe のセッションを作らない
     - ``paid_credits`` を 1 増やし、0 円の ``SUCCEEDED`` 取引を残す。電話番号確認と回数上限が条件
   * - ``POST /api/v1/internal/billing/notices``
     - しない。メールを送るだけ
     - 無料期間の終了が 3 日以内・1 日以内の契約へ通知し、``billing_notices`` に記録する
   * - :doc:`database` のチケット SQL
     - Stripe には届かない
     - ローカル DB の見た目だけ。本番では使わない

付与の条件は ``src/modules/billing/lib/billing.ts`` の ``loadPayableCheckout`` です。
``payment_status`` が ``paid``、通貨が ``jpy``、単発は現在の販売価格、定額は現在の販売価格かつ Price が ``STRIPE_PRICE_ID_MONTHLY_8`` か ``STRIPE_PRICE_ID_UNLIMITED``（既存加入者は ``STRIPE_PRICE_ID_MONTHLY_980_LEGACY``）、セッションの ``livemode`` が秘密鍵のモードと一致、``metadata.userId`` と Stripe 顧客 ID がその会員のチケット情報と一致するときだけチケットを増やします。
金額が無いセッションは付与しません。

価格キャンペーンと 0 円販売
---------------------------

販売価格は ``/console/pricing`` のキャンペーンで決まります。定価は単発 299 円、8件まで公開プラン 980 円、公開し放題プラン 2,980 円で、キャンペーンが無ければ定価です。

* 100% 割引のときだけ 0 円です。それ以外は 10 円単位の切り上げで、最低 10 円です。
* 0 円の単発は Stripe のセッションを作りません。確認済み電話番号があり、そのキャンペーンでの受け取りが上限未満のときだけ、``paid_credits`` を 1 増やします。``Idempotency-Key`` を変えても、同じキャンペーンで上限を超えて付与されることはありません。
* 0 円の定額プランも Price は加入する階層の定価のままです。100% off の繰り返しクーポンを付け、``payment_method_collection`` は ``always`` にします。テストカードを登録すると、初回は 0 円です。期間が終わると Stripe が定価で自動請求します。
* はじめての加入の初月無料は、この 0 円クーポンではなく ``subscription_data.trial_end`` で表します。初月無料の加入にクーポンは付けず、再加入者だけがキャンペーンのクーポンを使えます。
* 割引の月数は、加入からキャンペーン終了までを暦月で数えて切り上げ、1〜12 か月です。キャンペーンを停止しても、既存の加入者のクーポンは満了まで残ります。

無料期間の終了前通知は、``BILLING_NOTICE_SECRET`` を置いたうえで、日次で次を実行します。

.. code-block:: powershell

   npm run billing:notices

``MAIL_WEBHOOK_URL`` が空のときは、本文をサーバログに残し、``billing_notices.status`` を ``RECORDED`` にします。同じ契約と同じ終了日時には 1 回だけ送ります。テストで再送を見たいときは、``billing_notices`` の該当行を消してから実行します。

``stripeExpectsLive()`` は ``STRIPE_SECRET_KEY`` に ``_live_`` が含まれるかで判定します（ ``src/modules/billing/lib/stripe.ts`` ）。
テスト鍵のアプリに live の Webhook を流してもチケットは増えません。逆も同じです。

初月無料（トライアル）
----------------------

はじめての定額加入は、Stripe のネイティブトライアルで初月を 0 円にします。価格キャンペーンとは別の仕組みで、同じ加入には併用しません。

* 加入セッションは ``subscription_data.trial_end`` を 1 か月後にし、クーポン（ ``discounts`` ）は付けません。``billing_transactions`` は ``amount = 0``、``trial_applied = true``、``stripe_coupon_id`` は NULL になります。
* ``payment_method_collection`` は ``always`` です。0 円でもカードを登録し、無料期間が終わると Stripe が定価（980 円 / 2,980 円）で自動請求します。
* Stripe の購読状態は ``trialing`` になります。アプリは ``trialing`` を ``ACTIVE`` に写すので、無料期間中もイベントを公開できます。
* ``checkout.session.completed`` で ``user_usage_quotas.trial_ends_at`` と ``trial_used_at`` を記録します。``trial_used_at`` は無料期間が終わっても残し、再加入の判定に使います。
* 無料期間が終わって ``active`` になると ``trial_ends_at`` は NULL に戻ります（ ``customer.subscription.updated`` と ``invoice.payment_succeeded`` の両方）。
* 初月無料の対象かは ``GET /api/v1/billing/quota`` の ``trialEligible`` で分かります。再加入者にはキャンペーンのクーポンだけを付けます。

Test Clock での確認
~~~~~~~~~~~~~~~~~~~

1. Dashboard（**テストデータ**）の **Test clocks** で新しいクロックを作る。
2. そのクロックを選んだ状態で、会員として ``/service`` から定額プランへ加入する。テストカード ``4242 4242 4242 4242`` を使う。
3. Checkout 完了後、``user_usage_quotas`` の ``subscription_status`` が ``ACTIVE``、``trial_ends_at`` と ``trial_used_at`` が入っていることを見る。``billing_transactions`` は ``amount = 0``、``trial_applied = true`` の 1 行になる。
4. Test Clock を無料期間の 3 日前まで進め、``npm run billing:notices`` を実行する。 ``FREE_PERIOD_ENDING_3D`` が 1 回だけ届く。同じ日に再実行しても、 ``billing_notices`` の一意制約で再送しない。
5. さらに 1 日前まで進めて再実行し、 ``FREE_PERIOD_ENDING_1D`` が 1 回だけ届くことを見る。
6. 無料期間の終了まで進める。 ``invoice.payment_succeeded`` が届き、定価の取引が ``SUCCEEDED`` で増え、 ``trial_ends_at`` が NULL に戻ることを見る。
7. 解約して再加入し、加入セッションの応答 ``trial`` が ``null`` になる（初月無料が付かない）ことを確認する。

無料期間の途中で解約した場合も ``trial_used_at`` は残ります。再加入で初月無料をやり直すことはできません。

してはいけないこと
------------------

.. list-table::
   :header-rows: 1
   :widths: 42 58

   * - 禁止
     - 理由
   * - ``sk_live_`` をローカルの ``.env`` に置く
     - Checkout と Portal が本番へ出る
   * - テストと live の Price ID や ``whsec_`` を混ぜる
     - 付与拒否、署名失敗、別アカウントへの課金になる
   * - Dashboard を live のままテストカードを打つ
     - 実カードが必要になり、実課金になる
   * - ``/console/payments`` から返金や金額変更をする
     - その操作は実装していない。返金は Stripe Dashboard 側
   * - 本番データベースでチケット SQL や ``prisma migrate reset`` を実行する
     - 会員のチケット情報と決済履歴が消える、または偽のチケットが付く

テストモードでしてよいこと
--------------------------

* Dashboard を **テストデータ** 側にして、テストカードで Checkout する
* テストモードの Customer Portal で購読を解約する（ ``customer.subscription.deleted`` → ``CANCELED`` ）
* テストモードの Dashboard で全額返金する（ ``charge.refunded`` が届き、単発の未使用クレジットが残っていれば 1 戻す。定額は ``CANCELED`` ）
* ``stripe trigger`` で ``invoice.payment_failed`` などを送り、``PAST_DUE`` を見る

一部返金ではチケットを変えません。使い切ったあとの公開イベントは自動では消しません。

環境変数
--------

``.env`` の Stripe 関連です。値の置き場所は :doc:`local` と同じです。値は 1 行に 1 つ書きます。行末の ``"`` を落とすと次の行とつながり、Checkout が 500 になります（Stripe SDK は ``ERR_INVALID_CHAR`` を握りつぶすので、ログに理由が出ません）。

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - 名前
     - 役割
   * - ``STRIPE_SECRET_KEY``
     - ``sk_test_`` で始まる秘密鍵。 ``sk_live_`` は置かない
   * - ``STRIPE_WEBHOOK_SECRET``
     - ``whsec_`` で始まる署名鍵。 ``stripe listen`` が表示する値を入れる。Dashboard のエンドポイント秘密鍵と混ぜない
   * - ``STRIPE_PRICE_ID_MONTHLY_8``
     - テストモードで作った8件まで公開プラン 980 円（JPY、月次）の Price ID
   * - ``STRIPE_PRICE_ID_UNLIMITED``
     - テストモードで作った公開し放題プラン 2,980 円（JPY、月次）の Price ID
   * - ``STRIPE_PRICE_ID_MONTHLY_980_LEGACY``
     - 任意。値上げ前に加入した 980 円の公開し放題プランの Price。新規の申込には使わず、既存契約の検証だけに使う。名前を変える前の ``STRIPE_PRICE_ID_MONTHLY_980`` が設定されていれば、そちらも同じ用途で読みます
   * - ``STRIPE_PRICE_ID_ONE_TIME``
     - 任意。テストモードの単発 299 円 Price。空なら Checkout が 299 円の ``price_data`` をその場で作る。付与時はどちらも 299 円であること
   * - ``NEXT_PUBLIC_APP_URL``
     - Checkout と Portal の戻り先。起動しているオリジンと一致させる。``.env.example`` は ``http://localhost:3012``

定額の Price は **テスト Dashboard** で作ります。live の ``price_`` をテスト鍵と組み合わせると、金額や Price ID の検査で付与しません。

準備
----

1. Stripe Dashboard を開き、右上を **テストデータ** にする。
2. 商品と Price を作る。8件まで公開プランは 980 円、公開し放題プランは 2,980 円。どちらも通貨 JPY、請求は月次。料金の ``price_...`` を ``STRIPE_PRICE_ID_MONTHLY_8`` と ``STRIPE_PRICE_ID_UNLIMITED`` に入れる。値上げ前の 980 円の公開し放題プランは ``STRIPE_PRICE_ID_MONTHLY_980_LEGACY`` に残す。Product の表示名はアプリの札と揃える（「8件まで公開プラン」「公開し放題プラン」）。請求書と領収書（チケットの支払いのもので、参加費の集金とは別）に出る名前は Dashboard の Product 名であり、アプリ側の定数ではない。

   商品の URL に含まれる ``prod_...``（Product ID）を入れないでください。プランの判定は ``priceIdForPlan`` と ``planForPriceId`` が ``price_...`` の一致で行うため、Product ID を入れると決済は通っても契約の更新が反映されません。
3. Customer Portal をテストモードで有効にする。プラン・カード管理（``/organizer/plan``）の「カードを変更・解約」がここを開きます。入口は共通ヘッダーの頭文字のメニューの「プラン・カード管理」です。プラン変更（8 件プラン ↔ 公開し放題プラン）を選べるように設定します。ダウングレードしても既存の掲載は消さず、新規の公開だけを止めます。
4. ``NEXT_PUBLIC_APP_URL`` と開発サーバーのポートを揃える。``.env.example`` に合わせるときは ``npm run dev`` です。Web は 3012 です。
5. アプリを起動したまま、別の端末で Stripe CLI を実行する。転送先のホストとポートは ``NEXT_PUBLIC_APP_URL`` に合わせます。転送するイベントは、Webhook が処理する 7 つを明示します（Stripe CLI 1.55 以降は ``--events`` か ``--all-snapshot`` が要ります）。

.. code-block:: powershell

   stripe listen --forward-to localhost:3012/api/v1/webhooks/stripe --events checkout.session.completed,invoice.payment_succeeded,invoice.payment_failed,customer.subscription.updated,customer.subscription.deleted,charge.refunded,charge.dispute.created

CLI が表示する ``whsec_...`` を ``STRIPE_WEBHOOK_SECRET`` に書き、開発サーバーを再起動します。``stripe listen`` は起動するたびに署名鍵が変わるので、起動し直したら ``.env`` も書き換えます。

画面での確認
------------

会員登録と電話番号確認が終わった主催者で、 ``/organizer/events/new`` を開きます。 ``npm run db:seed`` の ``organizer@example.com`` をそのまま使えます。無料チケット 2 枚を使い切ると料金モーダルが出ます。
決済を通さずにモーダルだけ見る場合は、:doc:`database` の「ローカルでのチケットの書き換え」を使います。本番では使いません。

テストカードは次です。有効期限は未来の任意月、CVC は任意の 3 桁、郵便番号は任意です。

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - 番号
     - 結果
   * - ``4242 4242 4242 4242``
     - 成功
   * - ``4000 0000 0000 0002``
     - 失敗。定額の更新失敗や ``PAST_DUE`` を見るときに使う

単発と定額の反映経路は 2 つあり、同じ条件のときだけチケットを付けます。

* Checkout から戻った画面が ``POST /api/v1/billing/checkout/verify`` を呼ぶ
* Stripe が ``POST /api/v1/webhooks/stripe`` を呼ぶ。イベント ID は ``stripe_webhook_events`` に記録し、同じ ID の再送は本体処理をしない

処理するイベントは次のとおりです。実装は ``src/app/api/v1/webhooks/stripe/route.ts`` です。

.. list-table::
   :header-rows: 1
   :widths: 42 58

   * - イベント
     - データベースへの影響
   * - ``checkout.session.completed`` （ ``payment`` ）
     - 取引を ``SUCCEEDED`` にし、 ``paid_credits`` を 1 増やす
   * - ``checkout.session.completed`` （ ``subscription`` ）
     - 購読を ``ACTIVE`` にし、期間終了を保存する。初月無料なら ``trial_ends_at`` と ``trial_used_at`` も入れる。取引を ``SUCCEEDED`` にし、 ``trial_applied`` を残す
   * - ``invoice.payment_succeeded``
     - 顧客 ID または購読 ID からチケット情報を ``ACTIVE`` に更新する。初回の 0 円請求は ``trial_ends_at`` を記録し、 ``trial_applied`` を立てる。2 回目以降の定額請求は取引行を増やし、 ``trial_ends_at`` を NULL に戻す
   * - ``invoice.payment_failed``
     - ``subscription_status`` を ``PAST_DUE`` にする。イベント作成はできなくなる
   * - ``customer.subscription.updated``
     - Stripe の購読状態をチケット情報へ写す（ ``trialing`` は ``ACTIVE`` ）。 ``trialing`` のあいだだけ ``trial_ends_at`` を持ち、 ``active`` になったら NULL に戻す。想定外の Price では ``ACTIVE`` にしない
   * - ``customer.subscription.deleted``
     - ``subscription_status`` を ``CANCELED`` にする
   * - ``charge.refunded``
     - 全額のときだけ取引を ``REFUNDED`` にする。単発で未使用クレジットが残っていれば 1 戻す。定額は ``CANCELED``
   * - ``charge.dispute.created``
     - 取引を ``DISPUTED`` にし、全額返金と同じチケットの戻しを一度だけ行う

処理中に失敗した場合、記録した Webhook 行を削除してから 500 を返します。Stripe は再送できます。
署名が無い、または検証に失敗したときは 400 です。応答本文に検証ライブラリのメッセージは出しません。

確認
----

決済のあと、次でチケットと取引を見ます。SQL の全文は :doc:`database` です。

* ``user_usage_quotas.paid_credits`` が 1 増えている（単発）
* ``subscription_status`` が ``ACTIVE`` で、``current_period_end`` が未来（定額）
* 初月無料なら ``trial_ends_at`` と ``trial_used_at`` が入り、 ``billing_transactions.trial_applied`` が true（ ``amount`` は 0 ）
* ``billing_transactions`` に ``SUCCEEDED`` の行がある
* ``/console/payments`` に同じ行が見える。ここからは返金しない

自動テストとの分担
------------------

.. list-table::
   :header-rows: 1
   :widths: 28 72

   * - 経路
     - 範囲
   * - ``npm run check``
     - Stripe の鍵も Dashboard も不要。偽物の SDK とダミーの ``sk_test_`` / ``whsec_`` で署名と付与条件を見る
   * - このページ
     - Checkout 画面、Portal 画面、Webhook の転送、テストカード

CI に ``STRIPE_SECRET_KEY`` を登録する必要はありません。説明は :doc:`testing/ci` です。

本番（live）の準備
------------------

テストモードの設定は live へ引き継がれません。Product、Price、Webhook、Customer Portal の既定を
live でもう一度作ります。Dashboard を手で触らずに同じ状態へ揃えるため、
``scripts/stripe-live-setup.mjs`` が作り、``verify`` が食い違いを検査します。

金額はスクリプトに書きません。アプリの ``GET /api/v1/public/pricing`` が返す定価を読み、
その額で Price を作ります。``plans.ts`` を値上げして片方だけ直す、というずれを防ぐためです。

.. code-block:: powershell

   $env:STRIPE_SECRET_KEY = "sk_live_..."   # .env には置かない
   $env:NEXT_PUBLIC_APP_URL = "https://eventkreater.com"
   npm run stripe:setup -- --dry-run        # 何を作るかを先に見る
   npm run stripe:setup                     # 作る。再実行しても増えない
   npm run stripe:setup -- verify           # 読むだけ。ずれがあれば終了コード 1

スクリプトが決めること:

* Product は ``metadata.eventkreaterPlan``（ ``MONTHLY_8`` / ``UNLIMITED`` / ``ONE_TIME`` ）で見分ける。名前では見分けない
* Price は ``lookup_key``（ ``eventkreater_monthly_8`` など）で見分ける。金額か周期が変わっていたら、古い Price の lookup key を外して止め、新しい Price を作る
* 金額はすべて税込みの JPY。``unit_amount`` にそのまま入れる
* Webhook は ``/api/v1/webhooks/stripe`` の 1 本に、処理する 7 つのイベントを全部入れる
* Customer Portal は ``is_default`` の 1 本を作る。``route.ts`` が configuration を渡さないので、これがそのまま使われる

.. warning::

   Webhook の署名シークレットは API から取り出せません。既にあるエンドポイントを作り直すと、
   その瞬間の配信が落ちます。値が分からないときは Dashboard で **Roll secret** を押すか、
   承知のうえで ``npm run stripe:setup -- --rotate-webhook-secret`` を使ってください
   （削除して作り直し、新しい ``whsec_`` を表示します）。

Customer Portal の既定は、次の 3 点をアプリの約束に合わせます。ずれると、利用規約と画面の表示が嘘になります。

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - 設定
     - 理由
   * - ``proration_behavior = none``
     - 利用規約 第3条「日割りでの精算は行いません」。差額の返金も追加請求もしない
   * - ``subscription_cancel.mode = at_period_end``
     - 解約しても、支払った期間の終わりまでは使える（第9条）
   * - ``default_allowed_updates = ["price"]``
     - プラン変更だけを許す。数量や周期は画面から変えられない

最後に Fly の秘密を差し替えます。スクリプトが 1 行で出します。

.. code-block:: powershell

   fly secrets set STRIPE_SECRET_KEY="sk_live_..." STRIPE_WEBHOOK_SECRET="whsec_..." `
     STRIPE_PRICE_ID_MONTHLY_8="price_..." STRIPE_PRICE_ID_UNLIMITED="price_..." `
     STRIPE_PRICE_ID_ONE_TIME="price_..." --app event-creater-web

``STRIPE_PRICE_ID_MONTHLY_980_LEGACY`` は空のままにします。値上げ前に加入した 980 円の公開し放題プランを
検証するときだけ、その Price を入れます。

無料期間の終了前のお知らせ（本番の cron）
------------------------------------------

初月無料と 0 円プランの終了が近い契約へ、3 日前と 1 日前にメールを送ります。送るのは
``POST /api/v1/internal/billing/notices`` で、``x-billing-secret`` が要ります。重複は
``billing_notices`` の一意制約が防ぐので、1 日に何度走っても同じ人へ二重に送りません。

本番は ``.github/workflows/billing-notices.yml`` が 1 日 1 回（10:00 JST）叩きます。

1. Fly の ``BILLING_NOTICE_SECRET`` と同じ値を、GitHub の **Settings → Secrets and variables → Actions**
   に ``BILLING_NOTICE_SECRET`` として入れます。**Environment の秘密には入れません。**
   ``production`` environment はレビュー待ちで止まることがあり、定時の通知が届かなくなるためです。
2. **Actions → 無料期間の終了前のお知らせ → Run workflow** で 1 回手で流し、ログに
   ``{"sent":...}`` が出ることを確かめます。秘密が未設定なら、ジョブは失敗せず警告だけを出して終わります。
3. 時刻を変えるときは ``cron`` を直します。JST は UTC+9 です。GitHub の cron は混雑時に数分から
   十数分遅れることがありますが、その日のうちに送れれば足ります。

手元から同じ処理を試すときは ``npm run billing:notices`` です（ ``.env`` の
``BILLING_NOTICE_SECRET`` と ``NEXT_PUBLIC_APP_URL`` を読みます）。

