テスト範囲のフロー
==================

読む順の 8 番です。前は :doc:`vitest/practice`、次は :doc:`first-cases` です。

このページは、いまどこまで自動で確かめられているかと、次にどこを足すかを 1 か所にまとめます。考え方は :doc:`design`、書き方は :doc:`vitest/index` です。

図の読み方
----------

矢印のラベルに、確かめている手段を書きます。色では塗り分けません。色は凡例を見ないと意味が分からず、ノードを 1 つ足すたびに指定がずれるためです。

.. list-table::
   :header-rows: 1
   :widths: 24 76

   * - ラベルの頭
     - 意味
   * - ``unit:``
     - ``tests/unit/`` の単体テストで確認済み
   * - ``integration:``
     - ``tests/integration/`` の結合テストで確認済み。テスト用 PostgreSQL が要る
   * - ``route:``
     - Route Handler を直接呼ぶ試験。**まだありません**
   * - ``component:``
     - ``tests/components/`` の画面の試験。jsdom で描く
   * - ``E2E:``
     - ブラウザ行程。まだありません（Playwright 未導入）
   * - ``人手:``
     - 人が画面を見て確認する。:doc:`/local` と :doc:`/stripe`
   * - 頭に何も付かない
     - 画面の遷移としては存在するが、自動テストの対象にしていない

画面の遷移とテストの範囲
------------------------

ノードと矢印は、:doc:`/front_implementation_spec` の全体画面遷移と同じです。``SCR-ORG-10`` だけ、この機能で新しく足した画面です。

.. mermaid::

   graph LR
       S_EXPLORE((●))
       S_SHARE((●))
       S_REVISIT((●))
       S_NEW((●))
       S_BACK((●))
       S_CO((●))
       S_MYPAGE((●))
       S_ADM((●))
       S_PROSPECT((●))
       subgraph pub["公開・会員"]
           direction TB
           PUB00["SCR-PUB-00: ホーム<br/>/"]
           PUB01["SCR-PUB-01: 告知・出欠<br/>/events/[id]"]
           PUB02["SCR-PUB-02: 会員登録・ログイン<br/>/auth/register"]
           PUB03["SCR-PUB-03: 会員マイページ<br/>/mypage"]
           PUB06["SCR-PUB-06: サービス紹介<br/>/service"]
           PUB10["SCR-PUB-10: 利用規約<br/>/terms"]
       end
       subgraph org["主催"]
           direction TB
           ORG01["SCR-ORG-01: 主催イベント一覧<br/>/organizer/events"]
           ORG02["SCR-ORG-02: 新規イベント作成<br/>/organizer/events/new"]
           ORG03["SCR-ORG-03: チラシ選択モーダル"]
           ORG04["SCR-ORG-04: 公開完了モーダル"]
           ORG05["SCR-ORG-05: イベント編集<br/>/organizer/events/[id]/edit"]
           ORG06["SCR-ORG-06: 参加者名簿<br/>/organizer/events/[id]/participants"]
           ORG07["SCR-ORG-07: 共同幹事受諾<br/>/invitations/[code]"]
           ORG10["SCR-ORG-10: 公開直後の登録案内<br/>/organizer/register-required"]
           MOD02["排他ロック競合モーダル"]
       end
       subgraph admin["プラットフォーム管理者"]
           direction TB
           ADM00["SCR-ADM-00: 管理者ログイン<br/>/console/login"]
           ADM04["SCR-ADM-04: 管理者ホーム<br/>/console"]
           ADM01["SCR-ADM-01: 会員検索・権限変更<br/>/console/users"]
           ADM02["SCR-ADM-02: イベント検索<br/>/console/events"]
           ADM03["SCR-ADM-03: チケットの決済履歴<br/>/console/payments"]
           ADM05["SCR-ADM-05: 価格キャンペーン<br/>/console/pricing"]
       end
       subgraph bill["課金"]
           direction TB
           MOD01["SCR-MOD-01: 課金プランモーダル<br/>299円単発 / 8件まで公開プラン980円 / 公開し放題プラン2980円"]
           ST_CHECK["Stripe Hosted Checkout"]
           ST_PORTAL["Stripe Customer Portal"]
       end
       S_EXPLORE -.-> PUB00
       S_SHARE -.->|"共有URL"| PUB01
       S_REVISIT -.->|"告知URL"| PUB01
       S_REVISIT -.->|"未ログイン"| PUB00
       S_REVISIT -.->|"ログイン済み"| PUB03
       S_NEW -.->|"新規幹事"| PUB00
       S_BACK -.->|"未ログイン"| PUB02
       S_BACK -.->|"ログイン済み"| ORG01
       S_CO -.->|"招待URL"| ORG07
       S_MYPAGE -.->|"主催一覧"| ORG01
       S_ADM -.->|"ブックマーク"| ADM00
       S_PROSPECT -.-> PUB06
       PUB00 -.->|"イベント告知ページを作る"| ORG02
       PUB00 -.->|"主催者ログイン"| PUB02
       PUB00 -.->|"サービスと料金"| PUB06
       PUB01 -.->|"unit: 勧誘カードの出し分け と ref の適格判定"| ORG02
       PUB01 -->|"3秒出欠登録 Cookie付与"| PUB01
       PUB01 -.->|"会員登録して履歴保存"| PUB02
       PUB02 -->|"integration: チケットの引継ぎ"| PUB03
       PUB03 -.->|"ログアウト"| PUB00
       PUB06 -.->|"イベント告知ページを作る"| ORG02
       ORG01 -.->|"新規作成ボタン"| ORG02
       ORG01 -.->|"編集ボタン"| ORG05
       ORG01 -.->|"出欠確認 403 REGISTER_REQUIRED"| ORG06
       ORG01 -.->|"共同幹事を招待 403 REGISTER_REQUIRED"| ORG07
       ORG01 -.->|"サブスク管理"| ST_PORTAL
       ORG02 -.->|"チラシを選択"| ORG03
       ORG03 -.->|"アセット決定"| ORG02
       ORG02 -.->|"公開 上限未達 会員"| ORG04
       ORG02 -.->|"公開 上限未達 未登録"| ORG10
       ORG02 -.->|"integration: 2件目は403 画面内に案内"| ORG10
       ORG02 -->|"route これから: HTTP 402"| MOD01
       ORG02 -.->|"integration: 公開時のチケット消費"| ORG04
       ORG04 -.->|"共有リンク"| PUB01
       ORG04 -.->|"管理ダッシュボードへ"| ORG01
       ORG05 -.->|"unit: 24時間の境界"| ORG10
       ORG05 -.->|"他幹事編集中 409"| MOD02
       ORG05 -.->|"保存完了 ロック解放"| ORG01
       MOD02 -.->|"強制引き継ぎ"| ORG05
       ORG07 -.->|"受諾完了"| ORG01
       ORG10 -.->|"E2E これから: mode=register"| PUB02
       ORG10 -.->|"E2E これから: ログイン"| PUB02
       ORG10 -.->|"共有URLを配る"| PUB01
       ORG10 -.->|"登録済みは管理画面へ"| ORG01
       MOD01 -.->|"人手: 単発299円 / 8件まで公開プラン980円 / 公開し放題プラン2980円"| ST_CHECK
       ST_CHECK -.->|"人手: 決済成功"| ORG02
       ST_PORTAL -.->|"人手: 完了後に復帰"| ORG01
       ADM00 -.->|"ADMIN かつパスワード一致"| ADM04
       ADM04 -.->|"会員を探す"| ADM01
       ADM04 -.->|"イベントを探す"| ADM02
       ADM04 -.->|"決済を見る"| ADM03
       ADM04 -.->|"ログアウト"| ADM00
       ADM01 -.->|"ホームへ"| ADM04
       ADM02 -.->|"ホームへ"| ADM04
       ADM03 -.->|"ホームへ"| ADM04
       ADM01 -.->|"決済を見る"| ADM03
       ADM02 -.->|"会員を探す"| ADM01

現在のテスト
------------

.. count-start

138 ファイル、``it`` は 2118 件です。内訳は ``tests/unit/`` が 98 ファイル 1776 件、``tests/integration/`` が 28 ファイル 216 件です。結合の 216 件は ``TEST_DATABASE_URL`` があるときだけ走ります。すべて Stripe も OpenAI も呼びません。表はすべてのファイルを並べたものです。

.. count-end

.. list-table::
   :header-rows: 1
   :widths: 34 6 42 18

   * - ファイル
     - 件数
     - 何を確かめているか
     - 対応する画面
   * - ``tests/unit/auth-mode.test.ts``
     - 4
     - ``?mode=register`` と ``?mode=login`` の優先、``next`` だけのときの初期値、知らない値の扱い
     - SCR-ORG-10 → SCR-PUB-02
   * - ``tests/unit/guest-edit-window.test.ts``
     - 3
     - 作成から 24 時間ちょうどまで編集できる。1 ミリ秒でも過ぎたら 403 ``REGISTER_REQUIRED``。会員は無制限
     - SCR-ORG-05
   * - ``tests/unit/referrer.test.ts``
     - 4
     - 公開中・受付終了は参照元になれる。下書き・削除済み・不正な ID はなれない
     - SCR-PUB-01 → SCR-ORG-02
   * - ``tests/unit/organizer-invite.test.ts``
     - 4
     - 主催者への誘い（本文のカードと追従バーの帯）を出す条件。未ログインの参加者と主催イベントを持たない会員には出し、この催しの幹事と主催イベント持ちの会員には出さない
     - SCR-PUB-01
   * - ``tests/unit/hydration-quota.test.ts``
     - 4
     - 引き継いだ筆頭幹事の数だけ無料チケットが増える。上限を超えない。不正な値は 0 として扱う
     - SCR-PUB-02 → SCR-PUB-03
   * - ``tests/unit/problem.test.ts``
     - 4
     - ``REGISTER_REQUIRED`` の判定、文言の優先順、イベント ID の UUID 判定
     - 403 の共通処理
   * - ``tests/unit/flyer-quota.test.ts``
     - 14
     - チラシ生成の利用枠の判定。残数、上限、会員とゲストの扱い
     - SCR-ORG-08
   * - ``tests/unit/subscription-plans.test.ts``
     - 15
     - 8件まで公開プラン 980 円・公開し放題プラン 2,980 円・単発 299 円の定価、料金ページの 4 枚と勧める札、契約から販売商品への対応、キャンペーン対象の 3 価格（旧 ``SUBSCRIPTION`` は定額の両方）、今日（JST）の求め方とチケットの記録先（単発・無料チケットは件数の外）、8 件の上限、Price ID から加入プランへの対応（旧 980 円は公開し放題プランとして引き継ぐ）
     - SCR-MOD-01 / SCR-PUB-06 / SCR-ADM-05
   * - ``tests/unit/first-month-free.test.ts``
     - 10
     - 初月無料の対象判定（未使用・契約なし・支払済みなしの 3 条件）、再加入とプラン変更では再適用しないこと、加入から 1 か月後の終了日時（月末・うるう年・年またぎ）、元の日時を書き換えないこと
     - SCR-MOD-01 / SCR-PUB-06
   * - ``tests/unit/free-ticket.test.ts``
     - 19
     - 期限が最も近い券を選ぶ、期限切れと期限ちょうどの券は返さない、渡した配列を並べ替えない、動画券は前回発行から 30 日（暦月にしない）、紹介は生涯 10 枚で端数を落とす（9 枚なら 1 枚・10 枚なら 0 枚）、有効期限（動画 7 日・紹介と運営付与 3 か月・月末の丸め）
     - SCR-MOD-01 / SCR-PUB-06
   * - ``tests/unit/referral-code.test.ts``
     - 16
     - 紹介コードは 8 文字の英数で、読み間違えやすい 0・O・1・l を使わない、作るたびに違う、受け付ける形は 8 文字の英数だけ、自己紹介は配らない、紹介者が見つからなければ配らない、紹介券の理由キーは同じ人の同じ番号で変わらない、紹介 URL は紹介の着地ページ（``/invite/<code>``）を指し末尾のスラッシュが重ならずコードを URL に載せても壊れない形に包む、Cookie ``ref_code`` を 8 文字に削って読む
     - SCR-PUB-02 / SCR-PUB-03 / SCR-PUB-19
   * - ``tests/unit/event-details.test.ts``
     - 40
     - 日時の移行（チルダ・全角数字・1 桁のゼロ埋め・翌日またぎ）、料金の「無料」と補足、会場名と住所の結合、チラシ用の 30 文字以内の料金ラベル、男女別の組の判定・組単位のプラン名の反映と食い違いの検出・共通からの展開・組単位の上限・共通へ戻すときの同名の整理
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/unit/event-payload-schema.test.ts``
     - 17
     - 画面のフォーム値が API のペイロードになって ``CreateEventSchema`` を通る。補足・住所の空欄は null で送る。概要は省略・空・空白だけで null になり、タグを除いて 200 文字ちょうどは通り 201 文字は落ちる。``script`` は落とし、``javascript:`` のリンクは文字だけを残す
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/unit/event-summary.test.ts``
     - 21
     - 概要の表示文字数（タグ・``<br>``・ブロックの境界を数えず、``&amp;`` は 1 文字）、空白のそろえ方、200 文字ちょうどの通過と 201 文字の超過、リンク先の検証（``http`` / ``https`` だけを通し、``javascript:``・``data:``・``mailto:``・``tel:``・``ftp:`` を拒否し、スキーム省略に ``https://`` を補う）、無害化（許可タグの保持、``script`` と ``style`` の要素・``style`` 属性・``on*`` の除去、不正な ``href`` の文字だけの残し方、``target`` と ``rel`` の強制）、貼り付け用の実体参照の変換
     - SCR-ORG-02 / SCR-PUB-01
   * - ``tests/unit/event-steps.test.ts``
     - 35
     - 5ステップの並びと必須の範囲。各ステップの完了条件（名前と日時・料金プラン・開催場所・定員と期限・チラシ）。続きを開くステップの判定と復元時の開始位置。畳んだときの要約（日付・金額・場所・定員と期限・テーマ）。
     - SCR-ORG-02
   * - ``tests/unit/event-capacity.test.ts``
     - 8
     - 定員の選択肢が1〜50の1刻みであること。51以上は数値入力に寄せること。無制限・人数選択・51以上の切り替えで保存値が保たれること。数値入力が正の整数だけを受けること
     - SCR-ORG-02
   * - ``tests/unit/event-preview.test.ts``
     - 20
     - 対象世代の空白を落として空欄を null にし、テーマ ID をそのまま送ること。入力途中のフォームを告知ページの形へ寄せ、未入力の欄を「未入力」と出すこと。概要をプレビューへ写し、空・空白だけなら null にして送信時も null にすること。チラシの有無をプレビューの画像に反映すること。チラシ生成のペイロードに ``themeId`` を載せ、サービスへ ``semantic_theme`` として渡すこと。タイトル色は未指定なら ``title_color: null`` で送り、``#RRGGBB`` 以外を弾くこと。想定する世代が 50 文字なら受け、51 文字は弾くこと
     - SCR-ORG-02 / SCR-ORG-16 / SCR-PUB-01
   * - ``tests/unit/event-discounts.test.ts``
     - 16
     - 割引の表示文（補足の括弧・0 円は名前だけ）、並び順と表示用ラベル、定義が消えた参加者の写し、複数の割引の合計と 0 円止め、プラン未選択は null、同じ割引を選び直すと申込時点の金額を保つこと、保存済みの割引を入力行へ戻すこと、空の入力行
     - SCR-ORG-02 / SCR-ORG-05 / SCR-PUB-01
   * - ``tests/unit/revenue.test.ts``
     - 46
     - 見込み売上・集金済み額・未集金・平均単価の計算、不参加とプラン未選択の除外、無料プラン、0 除算、男女別の内訳、開催回別、参加人数を掛けた支払額と人数の合計、名簿に出す申込時点の金額、同じプランの再保存で金額を保つこと
     - SCR-ORG-06 / SCR-ORG-11 / SCR-ORG-12
   * - ``tests/unit/pending-form.test.ts``
     - 10
     - 登録前の入力の退避と復元、取り出すと 1 回で消えること、壊れた値と形の違う値を捨てること、概要を足す前の退避データは ``summary`` を空文字にそろえ概要つきは保つこと、保存先が無い・書けない環境でも落ちないこと
     - SCR-ORG-02
   * - ``tests/unit/analytics.test.ts``
     - 15
     - GA4 の計測の判定（測定 ID が空・本番以外は無効）、管理コンソールの除外と ``/consolex`` を巻き込まないこと、UUID と招待コードの置き換え、クエリとハッシュの切り落とし、末尾スラッシュ、パスでない値、``window`` と ``dataLayer`` が無いときに例外を投げないこと、``gtag`` があるときはコマンド形で送り ``dataLayer`` へ積まないこと
     - 全画面（第15章）
   * - ``tests/integration/collection.test.ts``
     - 5
     - 集金済みにすると日時が入り、戻すと空になること。出席のままなら出欠と人数を変えないこと。出席以外（参加要望・欠席）は記録せず 400 にすること。他のイベントの参加者は 404 にすること
     - SCR-ORG-06
   * - ``tests/integration/hydrate.test.ts``
     - 5
     - 筆頭幹事の付け替え、二度呼んでもチケットが増えない、上限を超えない
     - SCR-PUB-02 → SCR-PUB-03
   * - ``tests/integration/subscription-quota.test.ts``
     - 8
     - 公開中のイベントが 8 件に達したら 402 ``PUBLISHED_EVENTS_FULL``。開催日が過ぎたもの・公開を一時停止したもの・削除したものは数えない。8 件が埋まっていても単発クレジットがあれば 1 件追加できる。公開し放題プランは件数を数えない。公開の再開はチケットを再消費する。複製は下書きの時点では消費せず、開催日と候補日と申込締切を1か月後にずらす
     - SCR-ORG-02 / SCR-ORG-04 / SCR-MOD-01
   * - ``tests/integration/subscription-trial.test.ts``
     - 6
     - 無料期間中（``ACTIVE``・``trial_ends_at`` が未来）もイベントを公開でき、無料チケットと単発クレジットを減らさないこと。``trial_used_at`` がある会員と支払済みの月額がある会員は再加入でも対象外になること。``GET /api/v1/billing/quota`` が ``trial`` と ``trialEligible`` を返すこと。通知バッチが無料期間を拾い、3 日前と 1 日前に 1 回ずつ送り、同じ ``period_end`` では再送しないこと
     - SCR-MOD-01 / SCR-PUB-06
   * - ``tests/integration/free-ticket.test.ts``
     - 22
     - 同じ ``reason_key`` では 2 枚目を作れない、期限切れの券は選ばれない、期限を条件にしないと使用の印を立てられない、同じ券を 2 回消費できない、紹介の数え上げが生涯上限に達したら配らない、会員を消すと券も消える、紹介コードは一意で誰の紹介かは 1 度だけ決まる。消費順は「券が単発クレジットより先」「期限切れの券は飛ばす」「8 件プランが満杯でも券で 1 件だけ通る」「期限が近い券から使う」。チケット経由の公開も ``quota_source`` は ``PAID_CREDIT`` で、下書きの公開と即公開のどちらでも ``free_tickets.event_id`` が埋まる。``GET /api/v1/billing/quota`` が ``tickets`` を返し、券があれば ``canCreate`` が真になる。紹介の付与は、紹介された人の初回公開で 2 枚、2 回目では増えない、自己紹介と退会した紹介者では配らない、生涯 10 枚で止まる、即公開でも配る。``GET /api/v1/user/referral`` がコードを初回に作り、2 回目は同じコードを返す
     - SCR-MOD-01 / SCR-PUB-06
   * - ``tests/integration/referral-notification.test.ts``
     - 7
     - 催しに紐づかない 1 行として紹介者にだけ作られること、同じ紹介で 2 回呼んでも増えないこと、紹介された人が違えば別の行になること、紹介された人が消えていても文面が壊れないこと、通知 API が ``href`` をマイページにして ``eventId`` を null で返すこと、出欠の通知と混ざっても行き先が種別ごとに分かれること、初回公開でチケットと通知がそろって残ること
     - SCR-PUB-03 / SCR-PUB-19
   * - ``tests/integration/referral-invite.test.ts``
     - 6
     - 公開プロフィールの会員は名前・肩書き・自己紹介・テーマを返すこと、非公開なら名前だけを出すこと、コードの前後の空白を落とすこと、形が違うコードと存在しないコードと退会した会員のコードは null になること
     - SCR-PUB-19
   * - ``tests/unit/referral-notification.test.ts``
     - 10
     - 紹介の通知の題と、枚数・期限を 1 文に収めた本文、端数で 1 枚だけ配るときと 0 枚以下の枚数、空の名前で「さん」を付けないこと、長い名前でも題 100 文字・本文 300 文字に収まること、押した先がマイページであること、期限を日本時間の日付で書くこと、同じ紹介で同じ指紋になること
     - SCR-PUB-03 / SCR-PUB-19
   * - ``tests/unit/rsvp-notification.test.ts``
     - 23
     - 通知する変化（新規・欠席から・要望から出席へ・同じ状態の再送信・出席から要望や欠席へ）、出席と参加要望の文面と 300 文字での切り詰め、名簿への行き先、二重作成を防ぐ指紋（同じ入力で安定・宛先が違えば別）、宛先からゲスト主催者と自分を落とすこと、未読数の ``9+``
     - SCR-PUB-03 / SCR-ORG-06
   * - ``tests/unit/cohost-notification.test.ts``
     - 18
     - 共同主催の受諾・解除の文面（題 100 文字・本文 300 文字での切り詰め、名前や催し名が空でも壊れないこと、本人への解除は自分の名前を書かないこと）、宛先からゲスト幹事と行為者を落として重複を 1 回にすること、幹事の行や受け取る人が違えば指紋が変わること
     - SCR-PUB-03 / SCR-ORG-01
   * - ``tests/integration/rsvp-notifications.test.ts``
     - 7
     - オーナーと共同幹事にだけ作られること、自分が主催する催しへの自分の出欠は他の主催者にだけ作られること、同じ変化を 2 回呼んでも増えないこと、出席と参加要望の種別、既読が自分の行だけ変わること、他の会員の通知は一覧に出ず既読にもできないこと、未ログインは 401
     - SCR-PUB-03 / SCR-ORG-06
   * - ``tests/integration/revenue.test.ts``
     - 6
     - プラン金額を編集しても申込済みの見込み売上が変わらない。集金を記録すると集金済み額と未集金が動く。不参加は売上に含めない
     - SCR-ORG-06 / SCR-ORG-12
   * - ``tests/integration/event-discounts.test.ts``
     - 4
     - 割引の保存と並び順、定義を消しても参加者の写しが残ること、他イベントの割引 ID は 400、重複 ID を畳むこと、出席でないときは写しを作らないこと
     - SCR-ORG-02 / SCR-ORG-05 / SCR-PUB-01 / SCR-ORG-06
   * - ``tests/unit/auth-rate-limits.test.ts``
     - 25
     - 上限の既定値と環境変数の上書き、全ルールの対象名、バケット接頭辞の互換、上限の案内文、429 のヘッダ。出欠の ``rsvpIp``（30 回 / 1 分）と ``rsvpToken``（10 回 / 10 分）の既定値・窓・接頭辞・``RSVP_*`` による上書きと不正値の既定値戻し
     - SCR-PUB-02 / SCR-PUB-01 / ``/console/login``
   * - ``tests/integration/auth-attempts.test.ts``
     - 11
     - 窓の外を数えない、上限で 429、バケットの分離、成功時のリセット、厳しいほうの上限の選択、確認コードを使い切ったときの ``CODE_EXHAUSTED``。``?ref=`` 付きの登録は紹介者を ``referred_by_user_id`` に残し、存在しないコードでは残さない
     - SCR-PUB-02
   * - ``tests/integration/signup-resume.test.ts``
     - 7
     - 登録途中の再開。確認済みの意向はパスワード一致で ``phone_pending``、未確認は ``email_pending`` を返して会員を作らない。期限切れは 24 時間へ延ばしメール確認済みを保つ。不一致・意向なし・パスワードを持つ会員・パスワードなしの意向は ``none``
     - SCR-PUB-02
   * - ``tests/unit/allocation.test.ts``
     - 26
     - 均等割と比率割の計算、端数の寄せ先、集金済み額の按分、未割当の扱い、割合と人数の検証
     - SCR-ORG-12
   * - ``tests/unit/auth-links.test.ts``
     - 8
     - 戻り先をエンコードして保つ。電話番号の確認へ進んでも戻り先を失わない
     - SCR-PUB-02
   * - ``tests/unit/password-credential.test.ts``
     - 4
     - 非セキュアコンテキストと ``PasswordCredential`` 非対応では保存しない。``credentials.store`` が失敗しても例外にしない。成功時はメールアドレス・パスワード・名前を渡して 1 回だけ頼む
     - SCR-PUB-02
   * - ``tests/unit/auth-landing.test.ts``
     - 8
     - 有効なセッションで入口を開いたときの着地。``next`` の有無、入口、管理者、電話番号の確認状況の組み合わせ。``switch=1`` の判定
     - SCR-PUB-02 / SCR-PUB-07
   * - ``tests/unit/resend-cooldown.test.ts``
     - 7
     - 確認コードの再送を押せるまでの残り秒数。境界、送信前、端末の時計が戻ったとき
     - SCR-PUB-02
   * - ``tests/integration/login-challenge.test.ts``
     - 7
     - 同じ宛先への再送で前の確認番号が無効になる。送信上限で 429 と再試行時刻。一般会員の既定はメールで SMS の試行を数えない。SMS はチャネルを明示して確かめ、メールへ切り替えると宛先のマスクが変わる
     - SCR-PUB-02 / ``/console/login``
   * - ``tests/integration/password-reset.test.ts``
     - 8
     - パスワード再設定の依頼と確定。該当なし・退会済み・管理者ではトークンを作らず応答を同じにすること、発行し直すと前のリンクが無効になること、期限切れと使用済みは 400 ``RESET_TOKEN_INVALID``、成功でパスワードが変わり全セッションが失効して ``PASSWORD`` の記録が残ること、メール未確認の会員は ``emailVerifiedAt`` も埋まること、8 文字未満は 400 でリンクが残ること、同じ宛先の連続送信は 429 で上限と再試行時刻を返すこと
     - SCR-PUB-02
   * - ``tests/unit/checkout-intent.test.ts``
     - 7
     - 購入を開ける画面の制限、外部 URL と余計なクエリの拒否、戻り先の組み立て。``/organizer/plan`` は許可し、クエリ付きは拒否する
     - SCR-ORG-02 / SCR-ORG-17
   * - ``tests/unit/ci-scope.test.mjs``
     - 23
     - CI の対象判定。docs だけなら止め、``src``・``prisma``・workflow・``services/flyer`` の変更で必要なジョブを選ぶ
     - 該当なし（CI）
   * - ``tests/unit/client-ip.test.ts``
     - 8
     - 接続元 IP の採り方。``cf-connecting-ip`` → ``fly-client-ip`` → ``x-forwarded-for`` の末尾、詐称の無視
     - 該当なし（共通処理）
   * - ``tests/unit/robots.test.ts``
     - 2
     - ``robots.txt`` の ``disallow``。本番は ``/console``・``/organizers/``・``/invitations/`` を拒否し、staging は ``/`` で全パスを拒否する
     - 該当なし（クローラ対策）
   * - ``tests/unit/security-headers.test.mjs``
     - 6
     - ``next.config.mjs`` の ``headers()``。nosniff・Referrer-Policy・X-Frame-Options・Permissions-Policy・CSP（``frame-ancestors 'none'`` を含み ``script-src`` を持たない）を全環境に付け、HSTS は本番だけ、staging の ``X-Robots-Tag`` は 1 行だけ、本番の秘匿パスだけに ``noindex, nofollow`` を付けること
     - 全画面の共通ヘッダ
   * - ``tests/integration/rsvp-rate-limit.test.ts``
     - 4
     - 出欠の回数制限。上限で 429 と ``retryAt``・``Retry-After``、イベントが違えば独立、端末（Cookie）の枠は IP と別、DELETE は POST と同じ IP のバケットを消費する
     - SCR-PUB-01
   * - ``tests/unit/clone-shift.test.ts``
     - 6
     - 複製でずらす日付。1か月後へ送り、月末はその月の末日に丸め（1月31日→2月28日・閏年は2月29日）、年をまたぎ（12月15日→1月15日）、0か月は同じ日を返し、形の違う値はそのまま返す
     - SCR-ORG-01
   * - ``tests/unit/draft-lifecycle.test.ts``
     - 4
     - 下書きは受付停止にできない（409 ``DRAFT_CANNOT_STOP``）。公開の再開は受付停止だけ（409 ``NOT_CLOSED``）
     - SCR-ORG-02 / SCR-ORG-01
   * - ``tests/unit/draft-save.test.ts``
     - 12
     - 下書き保存の必須項目、保存と同時の公開状態の変更を断る、次に開くステップの判定
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/unit/draft-limit.test.ts``
     - 6
     - 下書きの上限（無料3件・980円10件・放題30件・単発クレジット持ちは10件）と、上限に達したときの 403 ``DRAFT_LIMIT_REACHED``（文言に上限の件数、``draftLimit`` を添える）
     - SCR-ORG-01 / SCR-ORG-02
   * - ``tests/unit/event-filters.test.ts``
     - 15
     - 主催一覧の絞り込み（状態・過去・開催日）、10 件ずつのページ割り、日本時間の今日
     - SCR-ORG-01
   * - ``tests/unit/published-counts.test.ts``
     - 4
     - マイページの公開中の件数を、月額プランとチケット（単発・無料チケット）に分ける。帯と同じく公開中・今日以降・自分の筆頭幹事だけを数え、チケットの記録が無い催しはチケット側に置く
     - SCR-PUB-03
   * - ``tests/unit/flyer-download.test.ts``
     - 11
     - ダウンロードの URL と ``Content-Disposition``、拡張子の対応、ファイル名の整形と長さの上限
     - SCR-ORG-08
   * - ``tests/unit/flyer-pdf.test.ts``
     - 11
     - A4 PDF のページ寸法、チラシ画像と QR の埋め込み、WebP の変換、PDF の URL とファイル名
     - SCR-ORG-05 / SCR-ORG-16
   * - ``tests/unit/flyer-candidates.test.ts``
     - 3
     - 背景の候補応答。AI が代替背景へ落ちた印（``ai_fallback``）を読み、古い応答は代替なしとみなし、紙面の性格は親の背景 ID だけを送って候補の配列だけを返す
     - SCR-ORG-08
   * - ``tests/unit/flyer-payload.test.ts``
     - 2
     - サービスへ渡す値。日付は紙面に焼ける日本語（年と曜日）へ直し、雨の扱いは表示用の札にする
     - SCR-ORG-08
   * - ``tests/unit/flyer-scope.test.ts``
     - 3
     - チラシの利用枠の対象判定。公開前の下書き、幹事以外は 403、ゲスト幹事のトークン
     - SCR-ORG-08
   * - ``tests/unit/flyer-upload.test.ts``
     - 8
     - 受け付ける画像形式（JPEG・PNG・WebP）、8MB の上限、端末ごとの回数制限
     - SCR-ORG-08
   * - ``tests/unit/venue-suggestions.test.ts``
     - 14
     - 会場の指紋（郵便番号のハイフンと空白の吸収、建物名の区別）、会員と端末の ownerKey、記録（未登録の Cookie 発行・会員は自分のみ・端末分の併用・失敗しても止めない）、一覧の重複除去と上限、削除の絞り込み
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/unit/voice-parse.test.ts``
     - 97
     - 音声の文字をフォームの値へ変える規則。全角の正規化、漢数字と桁の混在、日付の年解決（月の無い日・来月・再来月・今月末・曜日）、時刻の範囲と朝昼夜・長さからの終了時刻、金額、定員、郵便番号、都道府県の略称、番地、雨天時の方針、申し込み期限（前日・3日前・1週間前）、確認文の末尾の句読点を落とすこと
     - SCR-ORG-02
   * - ``tests/unit/voice-fields.test.ts``
     - 44
     - 音声で埋める欄の並びと巡回。空欄の飛ばし方、未登録の幹事の主催者名、任意の欄、戻る、入力欄の id からの逆引き、パッチの適用、料金の入口（プラン名の直前）で男女別を聞くか
     - SCR-ORG-02
   * - ``tests/unit/postal-code-search.test.ts``
     - 9
     - 郵便番号から住所を引く共通の検索。7 桁で自動検索する条件（同じコードは引き直さない・全角も可）、控えと同時実行のまとめ、7 桁に満たないときの非通信、失敗を控えないこと
     - SCR-ORG-02
   * - ``tests/unit/voice-mock.test.ts``
     - 25
     - 課金せずに試すためのモック。有効判定（本番では無効）、全欄の入力例が読めること、鍵なしで外部を呼ばないこと、API の応答と回数制限の扱い、モックの可否を返す GET と 1.5 秒での打ち切り、起動ログの出し分けと 1 度だけ出すこと
     - SCR-ORG-02
   * - ``tests/unit/voice-spotlight.test.ts``
     - 14
     - 音声モードの覆いの穴。高さが欄に追従せず固定であること、欄の中央への寄せ、画面端でのクランプ、幅と左の余白、くり抜きの描き順、マイクボタンを囲む丸い穴（中心・半径・閉じ方・向き）
     - SCR-ORG-02
   * - ``tests/unit/voice-panel.test.ts``
     - 11
     - 音声パネルの置き場所。欄のすぐ下に置く上端、欄の左に合わせて負は 0 に寄せる左端、右下のマイクボタンの手前で止める幅、ボタンを渡さない・欄の右より遠いときは欄の幅、重なるときも負にしない幅、余白の差し替え
     - SCR-ORG-02
   * - ``tests/unit/voice-guide.test.ts``
     - 4
     - 初回ガイドの記憶。閉じていなければ次も出す、閉じたら次からは自動で出さない、``localStorage`` が無い・読むだけで例外になる環境でも落ちずに毎回出す
     - SCR-ORG-02
   * - ``tests/unit/event-guide-placement.test.ts``
     - 48
     - 初回ガイドの穴と吹き出しの配置。見出しの外接矩形、穴を画面の 6 割と 120px の下限で収めること、入りきらない穴の上辺を対象へそろえること、吹き出しを上下どちらへ置くか、左右を穴の中心へ寄せること、画面下に固定する帯の余白、吹き出しが収まらないときに穴を縮めること、3 つの見出しを別々の穴でくり抜くこと、対象を画面へ寄せる位置（`planScroll`）
     - SCR-ORG-02
   * - ``tests/unit/event-guide-steps.test.ts``
     - 34
     - 初回ガイドの 9 枚。並び、指す対象のセレクタ、挨拶の枚が開閉を動かさないこと、2 枚目だけ全ステップを畳んで 3 つの見出しを別々に囲むこと、概要の枚が公開ページの冒頭に出ることを伝えること、料金の枚の箇条書き（本文と併記しないこと）、開くステップの移り変わり、ゲストと会員の最終枚の差し替え、知らないキーの扱い
     - SCR-ORG-02
   * - ``tests/unit/event-guide-memory.test.ts``
     - 6
     - 初回ガイドの記憶。閉じていなければ次も出す、「次回から表示しない」を選んだときだけ残す、``localStorage`` が無い・読むだけで例外になる環境でも落ちずに毎回出す
     - SCR-ORG-02
   * - ``tests/unit/event-guide-styles.test.mjs``
     - 37
     - 初回ガイドの重なりと押しやすさ。黒面 48・吹き出し 49 の順、画面下の帯とダイアログのあいだにあること、押せる的の 40px、文字の 15px、紙の朱の輪を常に出すこと
     - SCR-ORG-02
   * - ``tests/unit/voice-prompt.test.ts``
     - 11
     - 認識モデルへ渡すプロンプト。聞いている欄を短い文脈 1 文だけ置く、女性の金額は性別で呼ぶ、入力済みの催し名と会場名を当て字の手掛かりにする、手掛かりが無ければ行ごと落とす、指示文と数字表記の命令を含めない、欄の語彙は混ぜない、改行と制御文字を空白へ潰す、700 文字を超える手掛かりを落とす、欄が決まらないときの汎用の文
     - SCR-ORG-02
   * - ``tests/unit/voice-keywords.test.ts``
     - 15
     - 認識モデルへ渡す語彙。都道府県 47 の正式名と略称、雨天時の方針・金額・プラン名の語、入力済みの催し名と会場名を先に置くこと、いま聞いている欄の現在値は入れないこと、重複・空・禁止文字の除去、1 語 60 文字と 20 語の上限
     - SCR-ORG-02
   * - ``tests/unit/voice-confirm.test.ts``
     - 7
     - 確認を省くかの判定。未指定の欄は必ず確認する、形が閉じている 9 欄は値が読めた時点で省く、読めなかったときは省かない、自由文は省かない、確認ダイアログの入力が長い欄だけ複数行になること
     - SCR-ORG-02
   * - ``tests/unit/voice-utterance.test.ts``
     - 14
     - まとめて話した発話の扱い。読点・句点・話し言葉の助詞での節分割、日付・時刻・会場・金額・定員を 1 回で埋める割当、数字の節を閉じた欄へ先に配ること、同じマスに 2 回割り当てないこと、当たらない節を未割当として返すこと、自由文は欄の語彙を含む節だけを受けること
     - SCR-ORG-02
   * - ``tests/unit/voice-batch.test.ts``
     - 28
     - 未割当の節を LLM で補う処理と ``POST /api/v1/voice/utterances``。返る ``slotId`` の検証（存在しない欄・未割当でない節・読めない節は捨てる）、``VOICE_BATCH_LLM=0`` と未割当 0 件では外部を呼ばないこと、上流が失敗しても決定的な割当は返すこと、``json_schema`` 非対応なら 1 回だけやり直すこと、モックの 200 と回数非計上、控えのモデル名の返却、400 と 413。まとめて話す案内は、入力済みの欄を対象にしないこと、任意欄を外したスコープ、話す順のまとめ方、開始と終了を別のマスにして例だけ「18時から20時」にまとめること、空欄 3 つ以上で「まとめて」を既定にすること、モックの文が入力済みの例を含まないこと
     - SCR-ORG-02
   * - ``tests/unit/voice-sse.test.ts``
     - 27
     - 文字起こしの中継に使う SSE。チャンクの境目で切れたイベントの組み立て、複数行の data、``\r\n`` とコメント行の扱い、終端での flush、``delta`` / ``done`` / ``error`` の解釈と壊れた JSON の切り捨て、UTF-8 の 1 文字が切れても文字化けしないこと
     - SCR-ORG-02
   * - ``tests/unit/voice-transcribe.test.ts``
     - 15
     - 文字起こしの通信。``onDelta`` があるときだけ ``stream=true`` を送ること、増分の受信と ``done`` の全文、上流が stream を知らなければ 1 回やり直すこと、控えのモデル名の返却、最初の delta が 10 秒・間が 15 秒空いたときの打ち切り、画面側の SSE 読み取りと problem+json・中断の扱い
     - SCR-ORG-02
   * - ``tests/unit/voice-pcm.test.ts``
     - 23
     - 録音の音声変換。ステレオからモノラルへの平均、線形補間での 48kHz と 16kHz の変換、44 バイトのヘッダを持つ 16bit WAV への符号化、振幅の丸めと NaN の無音扱い、秒数からの容量見積もり
     - SCR-ORG-02
   * - ``tests/unit/guest-draft.test.ts``
     - 3
     - 作成の応答。下書きは公開 URL を返さない。公開済みは告知 URL を返す。``guestOrganizerToken`` は状態にかかわらず常に null
     - SCR-ORG-02
   * - ``tests/unit/line-share.test.ts``
     - 15
     - LINE 共有の本文（開催日の要約、1 行ずつの項目、空欄の詰め方）と、クエリのエンコード
     - SCR-PUB-01
   * - ``tests/unit/organizer-calendar.test.ts``
     - 19
     - 主催者カレンダーの月の計算（日本時間・うるう年・42 日固定）と、予定の並び順とセルの表記
     - SCR-ORG-13
   * - ``tests/unit/organizer-names.test.ts``
     - 9
     - 幹事の表示名の優先順位、筆頭の分離、公開用に渡す項目の絞り込み
     - SCR-ORG-01 / SCR-PUB-03
   * - ``tests/unit/image-crop.test.ts``
     - 24
     - ヘッダー画像を 3:1 に切り出す計算。枠を覆う倍率、ずらし幅の端、中心を保つ拡大、元画像の外へ出ない整数の矩形、切り出し幅 800px を割らない最大倍率とその判定
     - SCR-ORG-14
   * - ``tests/unit/organizer-profile.test.ts``
     - 44
     - プロフィールの入力検証（URL のホスト・ジャンル・文字数）、公開条件、実績の数え方、表示の短縮、テーマとアイコンとヘッダーの受け渡し
     - SCR-ORG-14 / SCR-PUB-14
   * - ``tests/unit/participant-calendar.test.ts``
     - 16
     - 参加者カレンダーの日付の決め方（複数日は選んだ日ごとに 1 件）、1 日 3 行への収め方、欠席の見せ方、主催者と参加者の遷移先
     - SCR-PUB-12
   * - ``tests/unit/participant-columns.test.ts``
     - 21
     - 参加者名簿の表示列。既定は名前・出欠・人数・料金プランの 4 列で、集金は既定に入れず選んだときだけ出す。操作の列は持たず、未知のキーと壊れた保存値は捨てて表示順に整え、空なら既定へ戻すこと、名前は外せないこと
     - SCR-ORG-06
   * - ``tests/unit/public-organizer-page.test.ts``
     - 34
     - 主催者ページの掲載条件、開催日の絞り込みと並び順、満員の色、公開 URL の組み立て
     - SCR-PUB-03
   * - ``tests/unit/rsvp-form.test.ts``
     - 26
     - 出欠の層の欄の出し分け。ログイン中の名前の扱い、性別に合う料金プラン、選べる札とその選択（性別を変えたときの移り先）、出席する日時の複数選択とトグル、参加人数の丸め、選んだ日時と人数の送信
     - SCR-PUB-01
   * - ``tests/unit/rsvp-modal-styles.test.mjs``
     - 12
     - 性別の札が 40px であること、日時が 3 件まで横並びであること、選べない札のグレーアウト、選んだ札が黒塗りではなく朱の枠と右上のチェックで示されること、層の本文の右余白と ``scrollbar-gutter``、切り替えリンクの不在
     - SCR-PUB-01
   * - ``tests/unit/rsvp-status.test.ts``
     - 13
     - 出欠の選択肢（出席・参加要望）と残席、席を確保済みの人の扱い、待ち順の決め方
     - SCR-PUB-01
   * - ``tests/unit/sample-events.test.ts``
     - 8
     - 告知ページの見本 5 件の slug が一意であること、チラシが ``public/samples`` に実在すること、テーマが既知の ID であること、日程と料金プランを 1 件以上持ち人数が定員を超えないこと、主催者を公開プロフィールへのリンクにしないこと、各見本の概要が 200 文字以内で許可タグだけであること、``findSample`` が未知の slug で undefined を返すこと
     - SCR-PUB-16 / SCR-PUB-17
   * - ``tests/unit/sample-profiles.test.ts``
     - 6
     - 主催者の見本 6 人の slug が一意で URL に使えること、名前・種別・肩書き（60）・自己紹介（400）・活動エリア（50）が製品の上限に収まること、テーマが既知の ID であること、ジャンルが固定リストから 3 つまでで重複しないこと、リンクが X / Instagram の https で許可ホストだけであること（``profileUrlProblem``）、実績の妥当性と ``findProfile`` が未知の slug で undefined を返すこと
     - SCR-PUB-18
   * - ``tests/unit/semantic-theme.test.ts``
     - 11
     - セマンティックテーマの ID と表示名（14 件・重複なし・空でない）、用途グループと所属の一致、未知の値と NULL の正規化、スキーマが 14 テーマと NULL を受け未知の ID を 400 にすること
     - SCR-ORG-14 / SCR-PUB-14
   * - ``tests/unit/semantic-theme-css.test.ts``
     - 9
     - テーマの ID と ``themes.css`` の対応（全テーマのブロックと必須 11 トークン）、``themes.css`` を ``index.css`` の最後に読むこと、ぼかしとアニメーションを持たないこと、全幅の面の広げ方、入力欄と案内文の基準
     - SCR-ORG-14 / SCR-PUB-14
   * - ``tests/unit/semantic-theme-quality.test.ts``
     - 162
     - 14 テーマのコントラスト（本文 7:1・補足と差し色 4.5:1・押せる部品の境界 3:1）、任意トークンの既定値の網羅と未使用検出、テーマ固有セレクタの禁止、6 軸で近すぎるテーマが無いこと、各テーマの書体と装飾のシグネチャ、見出しの書体が読み込み済みか総称だけを指すこと
     - SCR-ORG-14 / SCR-PUB-14
   * - ``tests/unit/design-scope.test.ts``
     - 8
     - パスから貼り紙の装飾スコープ（影だけ・静かめ・なし）を決める。``/console`` は装飾なし、``/organizer/events/new`` だけ静かめから影だけへ移る
     - 全画面の共通レイアウト
   * - ``tests/unit/style-breakpoints.test.mjs``
     - 4
     - 画面の幅の段（``min-width`` が 640 / 768 / 900 / 1024、``max-width`` が 360 / 400 / 480 / 540 と 1px 手前の対）と、幅の指定が px 付きの ``min-width`` / ``max-width`` だけで書かれていることを確かめる
     - 全画面の共通レイアウト
   * - ``tests/unit/button-rules.test.mjs``
     - 15
     - 押せる的とボタンの文字の大きさ（``--tap-target`` の 40px・``--font-action`` の 15px）、``.btn--sm`` が左右の余白だけを詰めて高さと文字を変えないこと、``.btn--lg`` の 52px・16px、装飾のある画面が高さを打ち消さないこと、入力欄の 16px と広い画面の 14px、ダイアログと暦の小さな操作、小ささの例外が 2 つだけであること（画面下に固定する帯 ``.action-dock`` は高さ 40px のまま文字だけ 14px、札の折りたたみ ``.event-card__more-body .btn`` は開いたときだけ 32px・13px で、常設の「申込/出欠一覧」「編集」は 40px・15px）、イベント札（スマホ 2 列・640px で 4 列・900px で 2 列）と名簿の行（スマホ 2 列）の並び
     - 全画面の共通レイアウト
   * - ``tests/unit/site-chrome.test.ts``
     - 17
     - パスから公開クロムの出し分けを決める。ホームはヘッダーを出さず上端の余白も落とす、``/console`` はヘッダーもフッターも出さない、主催者の公開ページはヘッダーだけ出さない、告知ページはヘッダーを出さずチラシを上端から始める、告知ページの見本（``/sample`` と ``/sample/<slug>``）はヘッダーを出さず上端の余白も落とす、下書きプレビューはヘッダーを出したまま上端の余白だけ落とす、その他は両方出す、``/consolelike`` や ``/samplelike`` を誤認しない。主催者の節（``OrganizerTabs``）を主催者管理の入口画面とイベント単位の名簿・売上だけに出し、作成・編集・プレビュー・登録案内には出さない。参加者の節（``ParticipantTabs``）を参加者ホーム・カレンダー・参加履歴だけに出し、参加者ログインの入口には出さない
     - 全画面の共通レイアウト
   * - ``tests/unit/site-copy.test.ts``
     - 4
     - 公開画面の主操作が 10 文字以内で条件を書かないこと、無料の条件は ``SITE.cta.freeNote``（30 文字以内）で伝え「チケット」の語を使わないこと、注記にカードの要否を混ぜないこと、見本への導線（``SITE.nav.sample``）を持つこと。注記はホームには置かず、``/sample`` が読む（2026-11-06 にホームから削除）
     - SCR-PUB-00 / SCR-PUB-16
   * - ``tests/unit/site-nav.test.ts``
     - 30
     - 共通ヘッダーの並びを会員の状態とパスから決める。未ログインはサービスと料金と 2 つの入口、参加者画面はナビを持たず（移動は ``ParticipantTabs``）、主催者は参加者画面と主催者画面で並びを変え、管理者はほかの条件より優先して管理コンソールだけを出す。主催者画面はバーのナビも「イベント告知ページを作る」も持たず（作成は主催一覧の下帯と本文が受ける）、主催者以外が主催者エリアを開いたときの戻り道だけを持ち、アカウントは本文が戻り先を持つのでナビを持たない。アカウントはどの並びにも入れず、頭文字のドロップダウンが持つ。ドロップダウンは参加者の「主催者として使う」とアカウント、主催者の参加者画面では主催者マイページと通知、主催者画面では通知と下書きを出し、節（``OrganizerTabs``）がある画面では主催者マイページを重ねず、作成・編集・プレビューなど節の無い画面でだけ残す。主催者画面の判定はパスの区切りまで見る。主催者として見ているあいだは、プラン・カード管理（``/organizer/plan``）をアカウントの直前に置き、参加者画面と管理者には出さない。役割の札（参加者・主催者・管理者）、いま見ている画面の名前（``viewerRoleCaption``）、頭文字（空の名前・絵文字を含む）も確かめる。アカウント設定の配下（``/account``・``/account/email/verify``）は共有領域として ``isOrganizer`` で立場を決め、本文の戻り先（主催者マイページ／参加者ホーム）と一致することも確かめる
     - 全画面の共通レイアウト
   * - ``tests/unit/site-area-coverage.test.ts``
     - 3
     - ``src/app/**/page.tsx`` を走査し、ヘッダーを出すすべての画面が ``viewerArea()`` で分類済み（``unclassified`` が無い）こと、``/account`` と ``/account/email/verify`` が共有領域であることを確かめる。画面を足して分類を忘れると落ちる
     - 全画面の共通レイアウト
   * - ``tests/unit/format.test.ts``
     - 16
     - 金額（``3,000円`` / ``¥3,000``）、保存形式の日付と月の見出し、日付の表記（``2026/11/21（土）`` を作る ``formatDateWithWeekdayJa``）、日時の表記、壊れた値の据え置き、日本時間の今月の範囲（UTC の月末が翌月になる場合を含む）
     - 全画面の共通表示
   * - ``tests/unit/mock-sync.test.mjs``
     - 86
     - HTML の整形（script・Next の CSS リンク・コメントの除去、``lang`` と body のクラスの保持）、アセットの差し替え（``/_next/image``・``/samples``・``data:``）、内部リンクの対応付けと未知リンクの ``#``、``uiHash`` の一致と変化（改行が CRLF でも LF でも同じ）、同期要否（manifest 無し・ハッシュ不一致・一致・HTML 欠け）、目録の No の重複と ``page.tsx`` の実在、``--only`` の絞り込み、枠ページ（iframe・幅の切り替え・状態の表記・エスケープ・生成物の欠け）、音声入力の写し（覆い・話し方で既定が変わる「任意の項目も聞く」・郵便番号の住所補完）
     - 該当なし（検査）
   * - ``tests/unit/write-if-changed.test.mjs``
     - 4
     - 生成物を中身が変わったときだけ書くこと。ファイルが無ければ書いて true を返す、同じ中身なら書かずに false を返して mtime も動かさない、違えば書き換えて true を返す、同期版も生成スクリプトから同じ規則で使える
     - 該当なし（検査）
   * - ``tests/unit/mail-webhook.test.mjs``
     - 26
     - メール中継の Worker。``POST`` 以外は 405、``GET /health`` は 200、トークンが違うパスと未設定は 404、JSON が読めない・``to`` / ``subject`` / ``body`` の形違いや空は 400、上限（件名 200 文字・本文 10000 文字）を超えたら 413、許可リスト外の宛先は 403 で Resend も ``fetch`` も呼ばない（``@example.com`` はドメイン全体、完全一致、大小文字を区別しない、``*`` は全宛先を許可、空なら全拒否）、成功は件名に接頭辞（``subjectPrefix``。staging は ``[stg]``、本番は既定で付けない）を付けて ``text`` で渡し 202、``subjectPrefix`` が文字列でなければ付けない、Resend が失敗か例外なら 502、ログは理由コードだけで宛先・件名・本文を出さない
     - 該当なし（検査）
   * - ``tests/unit/sms-webhook.test.mjs``
     - 21
     - SMS 中継の Worker。``POST`` 以外は 405、``GET /health`` は 200 で ``ok`` だけ、トークンが違うパスと未設定は 404、JSON が読めないは 400 ``INVALID_JSON``、配列と ``null`` は 400 ``INVALID_PAYLOAD``、``to`` が E.164 でなければ 400 ``INVALID_RECIPIENT``、``body`` が空か空白だけなら 400 ``MISSING_FIELD``、``body`` が 1000 文字を超えたら 413 ``TOO_LARGE``（1000 文字ちょうどは通す）、許可リストは完全一致だけを通し、空なら全拒否、``*`` は任意の宛先を通すが電話番号の検証は効き、許可外の宛先は 403 ``RECIPIENT_NOT_ALLOWED`` で Twilio も ``fetch`` も呼ばない、成功は 202 で SID・トークン・From・宛先・本文と打ち切り用の ``signal`` を渡し、Twilio が失敗を返したら 502 ``UPSTREAM_REJECTED``、例外なら 502 ``UPSTREAM_ERROR``、拒否と失敗のログは理由コードだけで宛先と本文を出さない
     - 該当なし（検査）
   * - ``tests/unit/dev-stuck.test.mjs``
     - 18
     - 開発サーバーが「ビルドに失敗したまま」固まったことを見つける判定。``EBUSY``・``Failed to read source code``・``os error 32`` を拾い、構文エラーやビルド成功の行は拾わない。立て直しの間隔（直前なら見送る）と、立て直した直後に前のプロセスの失敗を読み飛ばす時間の関係
     - 該当なし（検査）
   * - ``tests/unit/publish-confirm.test.ts``
     - 24
     - 公開の直前に確認を出すかの判定。定額（公開し放題プラン・8件まで公開プラン）が有効な間は出さず、期限切れは出す。支払いに問題がある間は出さない。8件まで公開プランの上限に達したときだけチケット・単発へ落とす。使う順はチケット → 単発 → 無料チケットで、電話番号が未確認なら無料チケットを除き、どれも無ければ出さない。チケット情報が分からないときも出さない。残り 1 で 0 に止める
     - SCR-ORG-16
   * - ``tests/components/auth-entry-screen.test.tsx``
     - 12
     - 登録・ログインの入口（``AuthEntryScreen``）。登録の成功は登録のフォームのまま確認メールの案内と再送を出し、ログインの見出し・パスワード欄を出さない。確認パネルの見出しと API の案内を重ねない。「メールアドレスを直す」で名前・メール・パスワードのフォームへ戻る。未確認のままログインしたときはログインフォームのまま再送を出す（FE-AUTH-17）。ログインのときだけパスワード欄の下に「パスワードを忘れた」のリンクを出し、入口（主催者・参加者）を引き継いだ依頼の画面へ送る（FE-AUTH-18）。再送の成功は「確認メールを送り直しました。」だけを出し、本文を重ねない
     - SCR-PUB-02
   * - ``tests/components/password-reset-screen.test.tsx``
     - 7
     - パスワードの再設定（``/auth/password/reset``）。依頼の成功で「リンクを送りました」に切り替わり共通文面を二重に出さないこと、``token`` 付きはメールアドレスではなく新しいパスワードの 2 欄になること、確認用の不一致と 8 文字未満は送らないこと、確定の成功は再設定した事実とログインへのボタンを出すこと、参加者のリンクは参加者の入口へ送ること、リンクが使えない（400）ときは送り直しの導線を出すこと
     - SCR-PUB-02
   * - ``tests/components/rsvp-modal.test.tsx``
     - 24
     - 出欠の層。選ぶ前から欄が出ること、欠席で消さずに押せなくすること、性別に合わない料金プランを残して無効にすること、男女別プランが 1 件でも欄が出ること、日時 3 件の横並びと複数選択、参加人数の入力と欠席時の無効化、文言「参加／欠席」「コメント」、送信本文の ``scheduleIds`` と ``partySize``、ログイン中の名前欄と「アカウントを切り替える」の不在、送る名前
     - SCR-PUB-01
   * - ``tests/components/participant-list-table.test.tsx``
     - 19
     - 名簿。人数は出席のときだけ出して欠席・参加要望は「—」、2 人以上は「1人 2,500円」と「3人 合計 7,500円」の 2 行、1 人は「支払額」だけ、参加要望の承認で人数の入力が出て出席で保存すること、出席で日時が 0 件なら保存できないこと
     - SCR-ORG-06
   * - ``tests/components/app-error.test.tsx``
     - 5
     - 画面が失敗したときの受け皿（``src/app/error.tsx``）。何が起きたかと、どうすればよいかを日本語で出す、失敗の中身（例外の文面）は出さない、主操作は「もう一度読み込む」1 つで押すと ``reset`` を呼ぶ、トップへ戻る道を持つ、``digest`` があるときだけ問い合わせ用の番号を出す
     - 全画面の共通レイアウト
   * - ``tests/components/quota-status-banner.test.tsx``
     - 9
     - 帯（``QuotaStatusBanner``）の導線。未加入は「月額プランを見る」を ``/organizer/plan`` へのリンクとして出し、「単発チケットを買う」で単発チケットの層を開く。公開し放題プランに加入中は 2 つとも出さない。支払いに問題がある間は単発のボタンだけを止め、月額のリンクは残す。0円キャンペーンで受け取れるときは「0円チケットを受け取る」にする
     - SCR-ORG-01
   * - ``tests/components/publish-confirm-modal.test.tsx``
     - 9
     - 公開前の確認の層。チケット・単発は「チケットを消費して公開します」で枚、無料チケットは「無料チケットを使って公開します」で枚。本文に使うものと残りの枚数を出す。「公開する」で ``onConfirm``、「やめる」で ``onClose``、送信中は 2 つのボタンを押せず主操作を「公開中…」にする
     - SCR-ORG-16
   * - ``tests/components/flyer-generate-panel-auth.test.tsx``
     - 4
     - 未ログインのチラシ作成。ボタンが「新規登録/ログインしてチラシ作成」で、押すと認証の導線を呼ぶこと。プレビューがあるときの「作り直す」も認証へ送ること。回数枠を使い切っていても押せること。会員は従来どおり「チラシを新規作成」であること
     - SCR-ORG-02
   * - ``tests/components/event-summary-editor.test.tsx``
     - 6
     - 概要の入力欄（``EventSummaryEditor``）。空のときは ``0 / 200`` を出して超過の印を付けないこと、入力済みの値を本文に描いてタグを除いた文字数を出すこと、本文を打つと innerHTML を ``onChange`` で返すこと、200 文字ちょうどは超過にせず 201 文字は ``aria-invalid`` と超過の 1 文を出すこと、``disabled`` では本文を編集できないこと
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/components/voice-address-search.test.tsx``
     - 5
     - 郵便番号を音声で確定したあと「住所を調べています」を出し、待ちの間は録音・戻る・スキップを止めること、1 件で都道府県・市区町村・町域が入って番地の録音へ進むこと、0 件でも 1 行の警告を出して進行を止めないこと、日時追加の確認が題だけの「別の日程も追加しますか？」であること、最終の終了時刻から男女別を聞いてからプラン名へ進むこと
     - SCR-ORG-02
   * - ``tests/components/voice-mock-recording.test.tsx``
     - 15
     - 音声入力のモック（ ``VOICE_TRANSCRIBE_MOCK=1`` ）。マイクを掴まずに開いた瞬間から録音中になること、確認のモーダルが出て値は確定まで入らないこと、「確定」で値が入って次の欄の録音へ進むこと、「再録音」で値を入れずに録り直すこと、録音中でもスキップが押せて次の欄の録音へ移ること、スキップの下に「スキップ」を出すこと、2 欄目から戻るが押せて前の欄の録音に戻ること、モックでなければこれまでどおり録音を試みてマイクの無い環境では案内を出すこと
     - SCR-ORG-02
   * - ``tests/components/voice-batch.test.tsx``
     - 11
     - まとめて話すの入口と確認。空欄が多いときは「まとめて」で始まり、開いた直後は録らず、後ろを黒透過の覆いで暗くすること、主ボタン（「録音を始める」）を押してから録ること、「録音ボタンを押して順に話してください。」と「全部読み上げ終えたら停止」が 2 行に並び、その下の話す順のマスが「1.」の番号と矢印で示され、その下の「読み上げ例：」の 1 文が録音中も文字化の途中も入れ替わらないこと、話す順のマス・任意の欄が既定で外れること、戻る・スキップといまの値を出さないこと、「1つずつ」へ切り替えると 1 欄ずつの質問と例に戻り、任意の欄が入り、まとめてに戻すと外れること、モックでは外部へ送らずに欄ごとの行と「Nつの欄に入れます。」を出し、当たらなかった欄を欄の名前だけで 1 行にまとめる（話した言葉は並べない）こと、チェックを外した行は入れず「すべて入力」が 1 回の更新にまとまること、残りの必須が 1 つなら「残りの欄は1つずつ話します。」で録音を始めること、2 つ以上なら「あとNつ。続けて話せます。」で録音を始めないこと、編集した行は編集後の文字で読み直すこと、初回ガイドの 2 択から始められること、案内を閉じると自動表示を止め、マイクを押せばまた出ること
     - SCR-ORG-02
   * - ``tests/integration/draft-publish.test.ts``
     - 4
     - 下書きの公開でチケットを 1 枚だけ消費する。二重公開は 409、チケット切れは 402
     - SCR-ORG-02
   * - ``tests/integration/draft-save-preview-publish.test.ts``
     - 5
     - 下書き保存ではチケットを消費せず公開で消費する。上書き保存の可否と、402・409・404 の分かれ方
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/integration/draft-limit.test.ts``
     - 9
     - 無料の4件目・980円の11件目・放題の31件目が 403 ``DRAFT_LIMIT_REACHED``。共同主催だけの下書きは数えず、過去日の下書きは数える。1件削除すれば作れる。上限でも既存の下書きの保存は通り、複製は 403。``GET /api/v1/billing/quota`` が下書きの件数と枠を返し、``canCreate`` の意味は変わらない
     - SCR-ORG-01 / SCR-ORG-02 / SCR-MOD-01
   * - ``tests/integration/organizer-avatar.test.ts``
     - 8
     - プロフィールのアイコンの登録（201・DB の行・WebP の配信）、差し替えで旧画像が 404、削除で参照が NULL、4MB 超と画像でないバイト列の拒否、``storage/images`` の後片付け
     - SCR-ORG-14
   * - ``tests/integration/organizer-header.test.ts``
     - 9
     - プロフィールのヘッダー画像の登録（201・DB の行・WebP 1920x640 の配信）、公開 API の ``headerUrl`` と非公開時の null、差し替えで旧画像が 404、削除で参照が NULL、横 800px 未満は 422、画像でないバイト列は 422、8MB 超は 413、``storage/images`` の後片付け
     - SCR-ORG-14
   * - ``tests/integration/organizer-profile.test.ts``
     - 17
     - プロフィールの保存と公開、テーマの保存と公開 API への反映、未知のテーマの 400、非公開に戻したときの扱い、退会者と UUID でない URL の 404、編集画面の応答の ``headerUrl``
     - SCR-ORG-14 / SCR-PUB-14
   * - ``tests/integration/organizers.test.ts``
     - 9
     - プレビューの主催者名と共同主催の人数、ゲストの表示名、招待の使い切り、受諾で受諾者以外の会員幹事にだけ通知が付きゲスト幹事には作らないこと、既に幹事なら通知が増えないこと、解除で外れた本人と残る幹事に通知が付き行為者には付かないこと、共同主催のイベントが主催一覧に ``CO_HOST`` として出ること
     - SCR-ORG-01
   * - ``tests/integration/public-organizer-page.test.ts``
     - 9
     - 主催者ページの API。未ログインでも催しを返し、下書き・過去日・削除済みを混ぜず、0件でも 200 の空一覧にする
     - SCR-PUB-03
   * - ``tests/integration/waitlist.test.ts``
     - 7
     - 満員時の参加要望への読み替え、行ロックで最後の 1 席を 1 人に限る、待ち順の繰り上がり
     - SCR-PUB-01
   * - ``tests/integration/participant-party-size.test.ts``
     - 6
     - 出席の人数を ``party_size`` の合計で数える、人数ぶんで席が足りないときの参加要望への読み替え、直す行の数え直し、承認の 409、選んだ全日の返却と代表日の決め方、イベントに無い日時の 400
     - SCR-PUB-01 / SCR-ORG-06
   * - ``tests/integration/participant-soft-delete.test.ts``
     - 12
     - 名簿からの論理削除と復元。DELETE で行を残して ``deletedAt`` を入れ、``userId`` と ``rsvpTokenHash`` を切り替える。削除済みは出席人数・名簿の集計・売上・待ち順から外れ、名簿 GET では末尾に返る。削除済みの編集と集金は 404、復元で戻り、満員なら 409 ``CAPACITY_REACHED``
     - SCR-ORG-06
   * - ``tests/integration/organizer-participant-create.test.ts``
     - 6
     - 主催者による参加者の追加。出席は料金・日時・割引の写しを入れて 201、満員の出席は 409 ``CAPACITY_REACHED`` で行は増えない、参加要望は満員でも追加でき待ち順の最後に並ぶ、受付停止中と期限切れでも追加できる、未登録のゲスト幹事は 403 ``REGISTER_REQUIRED``
     - SCR-ORG-06
   * - ``tests/integration/venue-suggestions.test.ts``
     - 2
     - 未登録の端末の候補を覚えて次回そのまま選べる。同じ会場は行を増やさず使用日時だけ進む。会員の候補は本人にだけ見え、他人は削除できない
     - SCR-ORG-02 / SCR-ORG-05

.. breakdown-start

件数の内訳は ``tests/unit/`` が 1776、``tests/integration/`` が 216 です。``TEST_DATABASE_URL`` の無い環境では、``npm test`` が 1776 件を実行して 216 件を skip します。

.. breakdown-end

これから書くテスト
------------------

上が先です。1 から 3 は ``tests/routes/`` を新設して、土台を 1 本通してから足します。

.. list-table::
   :header-rows: 1
   :widths: 6 30 30 34

   * - 順
     - 対象
     - 置き場所
     - 合格の形
   * - 0
     - ルート試験の土台。``NextRequest`` を組み、``@/lib/prisma`` を偽物にする 1 本
     - ``tests/routes/health.test.ts``
     - 200 が返る。偽物が呼ばれた回数を見る
   * - 1
     - 未登録の 2 件目を公開したときの応答
     - ``tests/routes/public-events.test.ts``
     - 403、``error`` は ``REGISTER_REQUIRED``、``type`` は ``probs/register-required``
   * - 2
     - 告知 API の ``viewer`` 3 フラグ（幹事本人・主催持ち・未ログイン）
     - ``tests/routes/public-event-viewer.test.ts``
     - ``hasOrganizerRole`` と ``isMember`` の組み合わせが 3 通り
   * - 3
     - 幹事 GET の ``registered``
     - ``tests/routes/organizer-event.test.ts``
     - 会員は ``true``、ゲストは ``false``
   * - 4
     - ``ref`` の永続化。不正な ID は NULL
     - ``tests/integration/referrer.test.ts``
     - ``referrer_event_id`` の値
   * - 5
     - hydrate の応答（``promotedOwners`` と ``freeEventCount``）
     - ``tests/integration/hydrate.test.ts`` に追加
     - 返り値と DB の両方
   * - 6
     - 勧誘カードの出し分け
     - ``tests/components/invite-card.test.tsx``
     - 3 状態で出る・出ない
   * - 7
     - 登録案内の 3 状態（未登録・登録済み・第三者）
     - ``tests/components/register-required.test.tsx``
     - 見出しの文言とリンク先
   * - 8
     - ブラウザ行程 2 本（会員登録、アカウントなしの出欠）
     - ``tests/e2e/``
     - ``npm run test:e2e``。**Playwright の導入が先**

6 と 7 は ``tests/components/rsvp-modal.test.tsx`` と同じ形で書けます。``jsdom`` と Testing Library は入り、``include`` は ``**/*.test.tsx`` も集めるので、足すのはファイルだけです。先頭の ``// @vitest-environment jsdom`` を忘れないでください。

層と境界
--------

同じ機能でも、どこを見るかで置き場所が変わります。

.. list-table::
   :header-rows: 1
   :widths: 22 30 16 32

   * - 層
     - 代表の関数
     - 見る手段
     - 見えないもの
   * - 画面
     - ``EventForm`` ``OrganizerInviteCard`` ``register-required/page.tsx``
     - ``component:`` これから
     - 実際の通信、Cookie の実物
   * - Route Handler
     - ``src/app/api/`` の ``GET`` ``POST``
     - ``route:`` これから
     - SQL の制約、行ロック
   * - ドメイン
     - ``assertGuestCanCreate`` ``assertGuestEditWindow`` ``migrateGuestOrganizers`` ``isEligibleReferrer`` ``resolveInitialAuthMode``
     - ``unit:`` と ``integration:``
     - HTTP の形
   * - 永続化
     - ``prisma.eventOrganizer`` ``userUsageQuota``
     - ``integration:``
     - 画面の見た目
   * - 外部
     - Stripe、OpenAI、チラシ API
     - 人手
     - 自動では確かめない

人が確認するもの
----------------

自動テストの対象にしないものは、:doc:`/local` と :doc:`/stripe` の手順で見ます。

* Stripe Hosted Checkout と Customer Portal の実画面
* Google サインイン
* チラシの見た目（1080×1528 の描画は :doc:`/flyer/testing/index` の pytest）
* 管理画面の各一覧

図を直すとき
------------

1. ノードを足したら、``subgraph`` のどこに属するかを決める。
2. 矢印を足したら、ラベルの頭に手段を書く。まだ無い手段は ``route これから:`` のように ``これから`` を入れる。
3. **色分けはしない。** ``linkStyle`` は番号で矢印を指すので、ノードを 1 つ足すと別の矢印の色が変わる。
4. テストを足したら、上の「現在のテスト」の表に行を足し、``npm run docs:counts`` で件数を書き戻してから ``npm run check:full`` を通す（表と件数は手で計算しない）。
5. 画面を足したら、:doc:`/front_implementation_spec` の表と :doc:`/sitemap` も直す。

次に読む
--------

:doc:`first-cases`
