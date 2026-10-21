最初に書くケース
================

読む順の 9 番です。前は :doc:`scope`、次は :doc:`local-run` です。

実装を始める入口は、このページの「データベース不要」です。PostgreSQL も Stripe の API も使わず、期待値が仕様の数そのものになります。ソースの所在は、利用枠が ``src/modules/billing/lib/quota.ts``、入力が ``src/lib/schemas.ts``、Webhook が ``src/app/api/v1/webhooks/stripe/route.ts`` です。

このページは、これから書くケースの一覧です。すでに書けた 67 件（ほかに結合 7 件）は :doc:`scope` にあります。重複するものは、そちらが現在の状態を示します。

データベース不要
----------------

ファイルは ``tests/unit/`` と ``tests/routes/`` です。``tests/routes/`` はまだ無いので、作るところから始めます。

入力スキーマは境界で拒否します。

.. list-table::
   :header-rows: 1
   :widths: 46 54

   * - 条件
     - 期待
   * - チラシ名が 1 文字
     - ``GenerateFlyerSchema`` が拒否し、文は「2文字以上40文字以内」
   * - チラシ名が 2 文字と 40 文字
     - 受け付ける
   * - チラシ名が 41 文字
     - 拒否し、文は「40文字以内」
   * - 日付 ``2026-02-31``
     - 形式は通ったあと、「実在する日付」で拒否
   * - 日付 ``2026-2-1``
     - 「日付形式(YYYY-MM-DD)が不正です」
   * - 登録パスワードが 7 文字
     - 「パスワードは8文字以上にしてください」
   * - 登録パスワードが 8 文字
     - 受け付ける
   * - 催し名が空
     - 「催しの名前を入力してください」
   * - 掲載フラグ ``visibility`` を送る
     - ``CreateEventSchema`` は受け取らず、保存値は常に ``UNLISTED`` （紹介制）
   * - 出欠の名前が空
     - 「名前を入力してください」
   * - 出欠コメントが 501 文字
     - ``SubmitRsvpSchema`` が拒否する

利用枠の純粋関数は、時刻を引数で固定します。

.. list-table::
   :header-rows: 1
   :widths: 52 48

   * - 条件
     - 期待
   * - ``ACTIVE`` かつ ``currentPeriodEnd`` が ``now`` より未来
     - ``isSubscriptionActive`` は true
   * - ``ACTIVE`` かつ期間終了が ``now`` と同じ
     - false。比較は ``>`` なので、同時刻は期限切れ
   * - ``ACTIVE`` かつ ``currentPeriodEnd`` が null
     - false
   * - ``PAST_DUE`` または ``CANCELED`` で期間終了が未来
     - false
   * - 請求行の ``period.end`` が Unix 秒
     - ``invoicePeriodEnd`` はその秒をミリ秒にした ``Date``
   * - 請求行が無い
     - ``invoicePeriodEnd`` は null
   * - 引数なしの ``quotaExceeded()``
     - status 402、``error`` は ``QUOTA_EXCEEDED``、``type`` は ``probs/quota-exceeded``
   * - 料金の選択肢
     - 単発 ``SINGLE`` が 299 円、月額 ``SUBSCRIPTION`` が 980 円で ``interval`` は ``month``

チラシへ渡す形と、認証の入口もデータベース不要です。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - 条件
     - 期待
   * - ``rainPolicy`` が ``RAIN_OR_SHINE``
     - ``toFlyerPayload`` の ``rain_policy`` は「雨天決行」。キーは snake_case
   * - 定員 10
     - ``capacity`` は「先着10名」
   * - 定員が null、または「先着N名」が 21 文字以上
     - ``capacity`` は null
   * - UUID でないチラシ ID
     - ``assertFlyerAssetId`` が 404、「チラシが見つかりません。」
   * - Cookie も ``Authorization`` も無い
     - ``requireUserId`` が 401、「ログインが必要です。」
   * - 確認番号が 5 桁
     - ``LoginChallengeConfirmSchema`` が拒否し、文は「確認番号は6桁です」
   * - 確認番号の経路が ``VOICE`` など、``SMS`` でも ``EMAIL`` でもない値
     - ``LoginChallengeDeliverSchema`` が拒否する。値は ``SMS`` と ``EMAIL`` だけ
   * - 確認番号を 3 回間違える
     - 400 で ``remainingAttempts`` が 7。文面は「あと7回でアカウントがロックされます。」
   * - 確認番号を 1 回だけ間違える
     - 400 で ``remainingAttempts`` が 9。文面にロックの予告は入らない
   * - 管理者が ``/api/v1/auth/local`` でログインする
     - 403 ``probs/forbidden``、``error`` は ``ADMIN_CONSOLE_REQUIRED``。チャレンジは発行しない
   * - 管理者が ``/console/login`` からログインする
     - 200 で ``challengeRequired``。確認後に ``/console`` へ入る
   * - 確認番号を 10 回間違える
     - 423 ``probs/account-locked``、``error`` は ``ACCOUNT_LOCKED``。``retryAfterSeconds`` は 900 前後、``lockedUntil`` は 15 分後
   * - ロック中に確認番号を発行・照合する
     - 同じ 423 ``probs/account-locked``。文面に解除までの残り分数が入る

男女別の費用は、画面の組の単位（削除とプラン名の反映）だけを純粋関数で決めます。保存形式は変えません。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - 条件
     - 期待
   * - 共通の行が1件ある
     - ``withGenderPricing`` が男性用・女性用の2件にする。元の行は id を保ち、女性用は新しい行になる
   * - 共通の行が5件ある
     - 8件で止まり、組の途中では切らない
   * - 共通の行と男性用の行が混ざっている
     - 共通の行だけが組になり、男性用の行はそのまま残る
   * - 男性用と女性用が隣り合っている
     - ``groupPricePlanPairs`` が1組にする
   * - 男性用だけが並んでいる
     - それぞれ1行だけの組になる。削除すると1行だけ消える
   * - 共通へ戻すと同名の行が2件できる
     - ``withCommonPricing`` が先の行だけを残す
   * - 1組のプラン名を入れる
     - ``withGroupName`` が男性用・女性用の両方へ同じ名前を入れ、金額と補足は行ごとに残す
   * - 組の中でプラン名がずれている
     - ``groupNamesDiffer`` が真になり、画面が警告を出す。1行だけの組は比較しない

幹事画面と管理画面をブラウザで開いたときは、冒頭の ``h1`` が画面名であることを見る。催し名は ``h1`` にしない。

Webhook の入口は ``POST`` を直接呼びます。``api.stripe.com`` へは出しません。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - 条件
     - 期待
   * - ``stripe-signature`` が無い
     - 400、``error`` は ``MISSING_SIGNATURE``
   * - ``STRIPE_WEBHOOK_SECRET`` または ``STRIPE_SECRET_KEY`` が空
     - 500、``error`` は ``WEBHOOK_NOT_CONFIGURED``
   * - ダミー鍵に対して署名が不正
     - 400。本文は ``Webhook Error:`` で始まる

テスト用データベース
--------------------

ファイルは ``tests/integration/`` です。接続先は ``event_platform_billing_test`` です。``consumeEventQuota`` は、行ロックのあと次の順で分岐します。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - 条件
     - 期待
   * - ``subscriptionStatus`` が ``PAST_DUE``
     - 402。詳細は支払い方法の更新を求める文
   * - ``ACTIVE`` かつ期間内
     - ``SUBSCRIPTION_UNLIMITED``。``freeEventCount`` も ``paidCredits`` も変えない
   * - サブスクは無効で ``paidCredits`` が 1 以上
     - ``PAID_CREDIT``。``paidCredits`` が 1 減る
   * - クレジットが 0 で ``freeEventCount`` が 2 未満、電話番号確認済み
     - ``FREE_TRIAL``。``freeEventCount`` が 1 増える
   * - クレジットが 0 で ``freeEventCount`` が 2 未満、電話番号未確認
     - 403、``PHONE_REQUIRED``。``freeEventCount`` は変わらない
   * - 無料枠が 2 に達している
     - 402、``QUOTA_EXCEEDED``。既定の詳細文は 2 回、299 円、980 円を含む

ロックと Webhook の再送も、このデータベースで見ます。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - 条件
     - 期待
   * - 空いているイベントでロックを取る
     - 行ができ、``lock_holder_name`` と ``lock_token_hash`` が入る
   * - 保持中に、別のトークンで取る
     - 更新行数は 0。保持者は変わらない
   * - ``forceTakeover`` が true
     - 保持者とトークンが新しい値に置き換わる
   * - 保持者が解放したあと、別のトークンで取る
     - 新しい保持者になる
   * - トークン不一致で ``assertLockHolder``
     - 409、``type`` は ``probs/lock-conflict``
   * - 同じ ``stripeEventId`` の Webhook を 2 回届ける
     - 2 回目は 200 で ``duplicate: true``。``paidCredits`` は 1 のまま

画面
----

前の二つのまとまりが通ってから、``tests/components/`` に次を書きます。このとき ``jsdom`` と ``@testing-library/react`` を足し、``vitest.config.ts`` の ``include`` に ``**/*.test.tsx`` を加えます。加えないと、置いたファイルは 1 件も集められません。

* イベント作成が HTTP 402 を返したとき、料金モーダルに 299 円と 980 円が出る
* 作成フォームが、空の催し名に「催しの名前を入力してください」を出す
* 勧誘カードが、幹事本人と主催イベント持ちには出ない
* 登録案内が、登録済みの幹事を管理画面へ返す

ブラウザの二本（ローカル登録、アカウントなしの出欠）は、そのあと :doc:`vitest/index` の Playwright で足します。

次に読む
--------

:doc:`local-run`
