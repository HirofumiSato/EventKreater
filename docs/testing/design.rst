テストの設計
============

読む順の 3 番です。前は :doc:`ideas`、次は :doc:`vitest/index` です。

サーバーを起動する試験と、起動しない試験を分けます。既定の ``npm test`` はプロセス内で終わり、PostgreSQL もブラウザも使いません。

層
--

.. list-table::
   :header-rows: 1
   :widths: 18 20 40 22

   * - 層
     - 入るコマンド
     - このアプリでの対象
     - いまの状態
   * - 静的検査
     - ``npm run check``
     - ``next lint`` と ``tsc --noEmit``
     - 稼働
   * - 純粋関数
     - ``npm test``
     - ``isEligibleReferrer``、``assertGuestEditWindow``、``mergedFreeEventCount``、``resolveInitialAuthMode``、``isRegisterRequired``、``isEventId``、``composeEventTime``、``parseLegacyPrice``、``flyerPriceLabel``
     - 67 件
   * - ルート
     - ``npm test``
     - Route Handler を直接呼ぶ。署名の無い Webhook は 400、未登録は 403 ``REGISTER_REQUIRED``、不正なボディは 422
     - これから
   * - DB 結合
     - ``npm run test:db``
     - ``assertGuestCanCreate``、``migrateGuestOrganizers``、``consumeEventQuota``、``tryAcquireLock``、同じ ``stripeEventId`` の再送
     - 7 件
   * - 画面の振る舞い
     - ``npm test``
     - 勧誘カードの出し分け、登録案内の 3 状態、HTTP 402 で料金モーダルが出る
     - これから（jsdom 未導入）
   * - ブラウザ行程
     - ``npm run test:e2e``
     - ローカル登録と、アカウントなしの出欠。各 1 本
     - これから（Playwright 未導入）

Route Handler は、``src/app/api/`` から export された ``GET`` や ``POST`` を import し、``NextRequest`` を渡して呼びます。``next dev`` も ``next start`` も立てません。戻り値の ``status`` と JSON を断言します。

画面の層は、クライアントコンポーネントに限って使います。サーバーコンポーネントのページ本体は、そのページが呼ぶ ``src/modules/`` と ``src/lib/`` の関数を試験します。

画面のどこを通すか
------------------

画面遷移のどの矢印を、どの手段で確かめるかは :doc:`scope` に 1 枚の図と表でまとめています。このページでは、手段の決め方だけを書きます。

* **値が仕様の数で決まるなら単体テスト。** 24 時間、無料枠 2 回、299 円と 980 円。
* **行ロックや一意制約が結論を変えるなら結合テスト。** 2 件目の拒否、二重 hydrate、同じイベント ID の再送。
* **HTTP の形が結論ならルート試験。** ステータス、``error``、``type`` を見ます。画面はその応答を見て分岐するだけです。
* **外部画面や目視が結論なら人手。** Stripe Checkout、Customer Portal、Google サインイン。

差し替え
--------

外部 I/O は、テストの中で偽物に差し替えます。

* ルート試験の Prisma は、``@/lib/prisma`` の偽物です。SQL の ``FOR UPDATE`` や一意制約は、この層では見えません。
* DB 試験の接続先は ``event_platform_billing_test`` です。開発用の ``event_platform_billing`` とは別のデータベースにします。手順の骨格は :doc:`/database` と同じです。
* Stripe は ``constructEvent`` と SDK のメソッドを偽物にします。署名そのものの試験では、ダミーの ``sk_test_`` と ``whsec_`` を置き、不正な署名を渡します。``constructEvent`` は手元で検証するので、``api.stripe.com`` へは出しません。
* ``getStripe`` はプロセス内にクライアントを保持します。署名の試験では、鍵をその試験の最初に固定します。
* チラシ API への ``fetch`` は偽物にします。接続失敗は 502、相手の 422 と 429 はそのステータスのまま、それ以外の失敗も 502 です。

いまの設定には、画面を動かすための部品がありません。``jsdom`` と ``@testing-library/react`` は未導入で、``vitest.config.ts`` の ``environment`` は ``node`` のままです。画面の試験を書くときに、この 2 つを足してから ``tests/components/`` を作ります。

ケースの切り方
--------------

ケースは、仕様の境界と失敗の分岐から切ります。チラシ API の :doc:`/flyer/testing/design` と同じ四種類です。

* **境界値。** チラシ名は 1 文字（未満）、2 文字（最小）、40 文字（最大）、41 文字（超過）。登録パスワードは 7 文字と 8 文字。無料枠の回数は 1 と 2。ゲストの作成は 1 件と 2 件。編集の猶予は 24 時間ちょうどと 1 ミリ秒超過。
* **同値分割。** 雨天方針 4 種とテンプレート ID は、同じ規則に属するので代表の 1 値で足りる。日付は形式違反と、形式は正しいが実在しない日を分ける。幹事の役割は ``OWNER`` と ``CO_HOST`` の 2 値で足りる。
* **分岐。** 利用枠は、サブスク有効、有料クレジット、無料枠（電話番号確認済み）、電話未確認の無料枠、上限到達、``PAST_DUE`` の六つ。優先順はこの順で、先の分岐に入ったら後の枠は減らない。
* **状態。** 同じ Stripe イベント ID の 2 回目は ``duplicate: true`` で、クレジットを足さない。ロックは未保持、有効期限内の他者、期限切れ、強制引き継ぎで結果が変わる。イベントは公開中・受付終了・下書き・削除済みで、参照元になれるかが変わる。

期待値は仕様の数のまま書きます。関数名は条件が読めるものにします。例は ``activeSubscriptionWithinPeriodIsUnlimited`` です。

ファイルの置き場所
------------------

実装ファイルはリポジトリ直下の ``tests/`` に置きます。``src/`` の隣です。

.. code-block:: text

   tests/
   ├── unit/          純粋関数と Zod。データベースも通信も不要
   ├── integration/   テスト用 PostgreSQL が要るもの。helpers.ts が行の作成と削除
   ├── setup/         db.ts。全テストの前に 1 回走る
   ├── routes/        これから。Route Handler。Prisma と Stripe は偽物
   └── components/    これから。Testing Library。見える文言と操作

ファイル名は ``対象.test.ts`` です。例は ``tests/unit/problem.test.ts`` です。コンポーネントを足すときは ``対象.test.tsx`` にしますが、そのとき ``vitest.config.ts`` の ``include`` に ``**/*.test.tsx`` を足す必要があります。今の設定は ``tests/**/*.test.ts`` だけを集めるので、``.test.tsx`` は置いても実行されません。

``tests/integration/`` は ``TEST_DATABASE_URL`` があるときだけ実行し、無ければ ``describe.skip`` で飛ばされます。``npm run test:db`` はこの層だけを実行します。分け方は :doc:`vitest/index` にあります。

次に読む
--------

:doc:`vitest/index`
