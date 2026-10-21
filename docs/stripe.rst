Stripe のローカルテストと操作
========================================

このページは、手元で Stripe のテストモードを使う手順と、お金に触る操作の境界です。
起動と画面パスは :doc:`local`、利用枠の確認 SQL は :doc:`database`、仕様の正は :doc:`billing_and_quota_system_requirements` です。

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
     - テスト鍵ならテスト上の 980 円。 ``sk_live_`` なら初回課金と以後の自動更新
     - 月額購読を開始する
   * - ``POST /api/v1/billing/portal``
     - 課金はしない。解約すると次回以降の請求が止まる（ live なら実契約）
     - カード変更と解約は Stripe 側。このアプリは URL を発行するだけ
   * - ``POST /api/v1/billing/checkout/verify``
     - しない。支払い済みセッションの確認
     - Webhook 遅延時に、同じ条件で枠を付与する
   * - ``POST /api/v1/webhooks/stripe``
     - しない。Stripe へ課金も返金も打ち返さない
     - 枠と ``billing_transactions`` の反映。イベント ID の再送は無視する
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
   * - :doc:`database` の利用枠 SQL
     - Stripe には届かない
     - ローカル DB の見た目だけ。本番では使わない

付与の条件は ``src/modules/billing/lib/billing.ts`` の ``loadPayableCheckout`` です。
``payment_status`` が ``paid``、通貨が ``jpy``、単発は現在の販売価格、月額は現在の販売価格で ``STRIPE_PRICE_ID_MONTHLY_980``、セッションの ``livemode`` が秘密鍵のモードと一致、``metadata.userId`` と Stripe 顧客 ID がその会員の利用枠と一致するときだけ枠を増やします。
金額が無いセッションは付与しません。

価格キャンペーンと 0 円販売
---------------------------

販売価格は ``/console/pricing`` のキャンペーンで決まります。定価は単発 299 円、月額 980 円で、キャンペーンが無ければ定価です。

* 100% 割引のときだけ 0 円です。それ以外は 10 円単位の切り上げで、最低 10 円です。
* 0 円の単発は Stripe のセッションを作りません。確認済み電話番号があり、そのキャンペーンでの受け取りが上限未満のときだけ、``paid_credits`` を 1 増やします。``Idempotency-Key`` を変えても、同じキャンペーンで上限を超えて付与されることはありません。
* 0 円の月額も Price は定価のままです。100% off の繰り返しクーポンを付け、``payment_method_collection`` は ``always`` にします。テストカードを登録すると、初回は 0 円です。期間が終わると Stripe が定価で自動請求します。
* 割引の月数は、加入からキャンペーン終了までを暦月で数えて切り上げ、1〜12 か月です。キャンペーンを停止しても、既存の加入者のクーポンは満了まで残ります。

無料期間の終了前通知は、``BILLING_NOTICE_SECRET`` を置いたうえで、日次で次を実行します。

.. code-block:: powershell

   npm run billing:notices

``MAIL_WEBHOOK_URL`` が空のときは、本文をサーバログに残し、``billing_notices.status`` を ``RECORDED`` にします。同じ契約と同じ終了日時には 1 回だけ送ります。テストで再送を見たいときは、``billing_notices`` の該当行を消してから実行します。

``stripeExpectsLive()`` は ``STRIPE_SECRET_KEY`` に ``_live_`` が含まれるかで判定します（ ``src/modules/billing/lib/stripe.ts`` ）。
テスト鍵のアプリに live の Webhook を流しても枠は増えません。逆も同じです。

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
   * - 本番データベースで利用枠 SQL や ``prisma migrate reset`` を実行する
     - 会員の枠と決済履歴が消える、または偽の枠が付く

テストモードでしてよいこと
--------------------------

* Dashboard を **テストデータ** 側にして、テストカードで Checkout する
* テストモードの Customer Portal で購読を解約する（ ``customer.subscription.deleted`` → ``CANCELED`` ）
* テストモードの Dashboard で全額返金する（ ``charge.refunded`` が届き、単発の未使用クレジットが残っていれば 1 戻す。月額は ``CANCELED`` ）
* ``stripe trigger`` で ``invoice.payment_failed`` などを送り、``PAST_DUE`` を見る

一部返金では枠を変えません。使い切ったあとの公開イベントは自動では消しません。

環境変数
--------

``.env`` の Stripe 関連です。値の置き場所は :doc:`local` と同じです。

.. list-table::
   :header-rows: 1
   :widths: 36 64

   * - 名前
     - 役割
   * - ``STRIPE_SECRET_KEY``
     - ``sk_test_`` で始まる秘密鍵。 ``sk_live_`` は置かない
   * - ``STRIPE_WEBHOOK_SECRET``
     - ``whsec_`` で始まる署名鍵。 ``stripe listen`` が表示する値を入れる。Dashboard のエンドポイント秘密鍵と混ぜない
   * - ``STRIPE_PRICE_ID_MONTHLY_980``
     - テストモードで作った月額 980 円（JPY、月次）の Price ID
   * - ``STRIPE_PRICE_ID_ONE_TIME``
     - 任意。テストモードの単発 299 円 Price。空なら Checkout が 299 円の ``price_data`` をその場で作る。付与時はどちらも 299 円であること
   * - ``NEXT_PUBLIC_APP_URL``
     - Checkout と Portal の戻り先。起動しているオリジンと一致させる。``.env.example`` は ``http://localhost:3012``

月額 Price は **テスト Dashboard** で作ります。live の ``price_`` をテスト鍵と組み合わせると、金額や Price ID の検査で付与しません。

準備
----

1. Stripe Dashboard を開き、右上を **テストデータ** にする。
2. 商品と Price を作る。月額は 980 円、通貨 JPY、請求は月次。その ID を ``STRIPE_PRICE_ID_MONTHLY_980`` に入れる。
3. Customer Portal をテストモードで有効にする。マイページの「プラン・カード管理」がここを開きます。
4. ``NEXT_PUBLIC_APP_URL`` と開発サーバーのポートを揃える。``.env.example`` に合わせるときは ``npm run dev`` です。Web は 3012 です。
5. アプリを起動したまま、別の端末で Stripe CLI を実行する。転送先のホストとポートは ``NEXT_PUBLIC_APP_URL`` に合わせます。

.. code-block:: powershell

   stripe listen --forward-to localhost:3012/api/v1/webhooks/stripe

CLI が表示する ``whsec_...`` を ``STRIPE_WEBHOOK_SECRET`` に書き、開発サーバーを再起動します。

画面での確認
------------

会員登録と電話番号確認が終わった主催者で、 ``/organizer/events/new`` を開きます。 ``npm run db:seed`` の ``organizer@example.com`` をそのまま使えます。無料 2 回を使い切ると料金モーダルが出ます。
決済を通さずにモーダルだけ見る場合は、:doc:`database` の「ローカルでの利用枠の書き換え」を使います。本番では使いません。

テストカードは次です。有効期限は未来の任意月、CVC は任意の 3 桁、郵便番号は任意です。

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - 番号
     - 結果
   * - ``4242 4242 4242 4242``
     - 成功
   * - ``4000 0000 0000 0002``
     - 失敗。月額の更新失敗や ``PAST_DUE`` を見るときに使う

単発と月額の反映経路は 2 つあり、同じ条件のときだけ枠を付けます。

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
     - 購読を ``ACTIVE`` にし、期間終了を保存する。取引を ``SUCCEEDED`` にする
   * - ``invoice.payment_succeeded``
     - 顧客 ID または購読 ID から利用枠を ``ACTIVE`` に更新する。2 回目以降の月額請求は取引行を増やす
   * - ``invoice.payment_failed``
     - ``subscription_status`` を ``PAST_DUE`` にする。イベント作成はできなくなる
   * - ``customer.subscription.updated``
     - Stripe の購読状態を利用枠へ写す。想定外の Price では ``ACTIVE`` にしない
   * - ``customer.subscription.deleted``
     - ``subscription_status`` を ``CANCELED`` にする
   * - ``charge.refunded``
     - 全額のときだけ取引を ``REFUNDED`` にする。単発で未使用クレジットが残っていれば 1 戻す。月額は ``CANCELED``
   * - ``charge.dispute.created``
     - 取引を ``DISPUTED`` にし、全額返金と同じ枠の戻しを一度だけ行う

処理中に失敗した場合、記録した Webhook 行を削除してから 500 を返します。Stripe は再送できます。
署名が無い、または検証に失敗したときは 400 です。応答本文に検証ライブラリのメッセージは出しません。

確認
----

決済のあと、次で枠と取引を見ます。SQL の全文は :doc:`database` です。

* ``user_usage_quotas.paid_credits`` が 1 増えている（単発）
* ``subscription_status`` が ``ACTIVE`` で、``current_period_end`` が未来（月額）
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
