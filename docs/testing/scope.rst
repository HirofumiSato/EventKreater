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
     - 画面の試験。まだありません（jsdom 未導入）
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
           ADM03["SCR-ADM-03: 利用枠の決済履歴<br/>/console/payments"]
           ADM05["SCR-ADM-05: 価格キャンペーン<br/>/console/pricing"]
       end
       subgraph bill["課金"]
           direction TB
           MOD01["SCR-MOD-01: 課金プランモーダル<br/>299円単発 と 980円月額"]
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
       PUB02 -->|"integration: 枠の引継ぎ"| PUB03
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
       ORG02 -.->|"integration: 公開時の枠消費"| ORG04
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
       MOD01 -.->|"人手: 単発299円 と 月額980円"| ST_CHECK
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

51 ファイル、``it`` は 636 件です。内訳は ``tests/unit/`` が 39 ファイル 567 件、``tests/integration/`` が 12 ファイル 69 件です。結合の 69 件は ``TEST_DATABASE_URL`` があるときだけ走ります。すべて Stripe も OpenAI も呼びません。表はすべてのファイルを並べたものです。

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
   * - ``tests/unit/hydration-quota.test.ts``
     - 4
     - 引き継いだ筆頭幹事の数だけ無料枠が増える。上限を超えない。不正な値は 0 として扱う
     - SCR-PUB-02 → SCR-PUB-03
   * - ``tests/unit/problem.test.ts``
     - 4
     - ``REGISTER_REQUIRED`` の判定、文言の優先順、イベント ID の UUID 判定
     - 403 の共通処理
   * - ``tests/unit/flyer-quota.test.ts``
     - 14
     - チラシ生成の利用枠の判定。残数、上限、会員とゲストの扱い
     - SCR-ORG-08
   * - ``tests/unit/event-details.test.ts``
     - 40
     - 日時の移行（チルダ・全角数字・1 桁のゼロ埋め・翌日またぎ）、料金の「無料」と補足、会場名と住所の結合、チラシ用の 30 文字以内の料金ラベル、男女別の組の判定・組単位のプラン名の反映と食い違いの検出・共通からの展開・組単位の上限・共通へ戻すときの同名の整理
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/unit/event-payload-schema.test.ts``
     - 5
     - 画面のフォーム値が API のペイロードになって ``CreateEventSchema`` を通る。補足・住所の空欄は null で送る
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/unit/event-steps.test.ts``
     - 30
     - 5ステップの並びと必須の範囲。各ステップの完了条件（名前と日時・費用プラン・開催場所・定員と期限・チラシ）。続きを開くステップの判定と復元時の開始位置。畳んだときの要約（日付・金額・場所・定員と期限）
     - SCR-ORG-02
   * - ``tests/unit/event-capacity.test.ts``
     - 8
     - 定員の選択肢が1〜50の1刻みであること。51以上は数値入力に寄せること。無制限・人数選択・51以上の切り替えで保存値が保たれること。数値入力が正の整数だけを受けること
     - SCR-ORG-02
   * - ``tests/unit/revenue.test.ts``
     - 28
     - 見込み売上・領収書発行額・差額・平均単価の計算、不参加とプラン未選択の除外、無料プラン、0 除算、男女別の内訳、開催回別、名簿に出す申込時点の金額、同じプランの再保存で金額を保つこと
     - SCR-ORG-06 / SCR-ORG-11 / SCR-ORG-12
   * - ``tests/integration/guest-limit.test.ts``
     - 4
     - 未登録は筆頭幹事として 1 件まで。共同幹事だけなら数えない。削除済みでも数える
     - SCR-ORG-02
   * - ``tests/integration/hydrate.test.ts``
     - 5
     - 筆頭幹事の付け替え、二度呼んでも枠が増えない、上限を超えない
     - SCR-PUB-02 → SCR-PUB-03
   * - ``tests/integration/revenue.test.ts``
     - 6
     - プラン金額を編集しても申込済みの見込み売上が変わらない。領収書発行額との差額。不参加は売上に含めない
     - SCR-ORG-06 / SCR-ORG-12
   * - ``tests/unit/auth-rate-limits.test.ts``
     - 18
     - 上限の既定値と環境変数の上書き、全ルールの対象名、バケット接頭辞の互換、上限の案内文、429 のヘッダ
     - SCR-PUB-02 / ``/console/login``
   * - ``tests/integration/auth-attempts.test.ts``
     - 9
     - 窓の外を数えない、上限で 429、バケットの分離、成功時のリセット、厳しいほうの上限の選択、確認コードを使い切ったときの ``CODE_EXHAUSTED``
     - SCR-PUB-02
   * - ``tests/unit/allocation.test.ts``
     - 25
     - 均等割と比率割の計算、端数の寄せ先、領収書発行額の按分、未割当の扱い、割合と人数の検証
     - SCR-ORG-12
   * - ``tests/unit/auth-links.test.ts``
     - 3
     - 戻り先をエンコードして保つ。電話番号の確認へ進んでも戻り先を失わない
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
     - 3
     - 同じ宛先への再送で前の確認番号が無効になる。送信上限で 429 と再試行時刻。メールへ切り替えたときの宛先
     - SCR-PUB-02 / ``/console/login``
   * - ``tests/unit/checkout-intent.test.ts``
     - 7
     - 購入を開ける画面の制限、外部 URL と余計なクエリの拒否、戻り先の組み立て
     - SCR-ORG-02
   * - ``tests/unit/ci-scope.test.mjs``
     - 23
     - CI の対象判定。docs だけなら止め、``src``・``prisma``・workflow・``services/flyer`` の変更で必要なジョブを選ぶ
     - 該当なし（CI）
   * - ``tests/unit/client-ip.test.ts``
     - 8
     - 接続元 IP の採り方。``cf-connecting-ip`` → ``fly-client-ip`` → ``x-forwarded-for`` の末尾、詐称の無視
     - 該当なし（共通処理）
   * - ``tests/unit/draft-lifecycle.test.ts``
     - 2
     - 下書きは受付停止にできない（409 ``DRAFT_CANNOT_STOP``）
     - SCR-ORG-02
   * - ``tests/unit/draft-save.test.ts``
     - 12
     - 下書き保存の必須項目、保存と同時の公開状態の変更を断る、次に開くステップの判定
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/unit/flyer-download.test.ts``
     - 11
     - ダウンロードの URL と ``Content-Disposition``、拡張子の対応、ファイル名の整形と長さの上限
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
     - 49
     - 音声の文字をフォームの値へ変える規則。全角の正規化、漢数字と桁の混在、日付の年解決、時刻の範囲、金額、定員、郵便番号、都道府県、番地、雨天時の方針、申し込み期限
     - SCR-ORG-02
   * - ``tests/unit/voice-fields.test.ts``
     - 24
     - 音声で埋める欄の並びと巡回。空欄の飛ばし方、未登録の幹事の主催者名、任意の欄、戻る、入力欄の id からの逆引き、パッチの適用
     - SCR-ORG-02
   * - ``tests/unit/voice-mock.test.ts``
     - 16
     - 課金せずに試すためのモック。有効判定（本番では無効）、全欄の入力例が読めること、鍵なしで外部を呼ばないこと、API の応答と回数制限の扱い、起動ログの出し分けと 1 度だけ出すこと
     - SCR-ORG-02
   * - ``tests/unit/guest-draft.test.ts``
     - 3
     - 未登録は下書きを作れず 403 ``REGISTER_REQUIRED``。公開済みは告知 URL とゲスト幹事トークンを返す
     - SCR-ORG-02
   * - ``tests/unit/line-share.test.ts``
     - 15
     - LINE 共有の本文（開催日の要約、1 行ずつの項目、空欄の詰め方）と、クエリのエンコード
     - SCR-PUB-01
   * - ``tests/unit/organizer-calendar.test.ts``
     - 16
     - 主催者カレンダーの月の計算（日本時間・うるう年・42 日固定）と、予定の並び順とセルの表記
     - SCR-ORG-09
   * - ``tests/unit/organizer-names.test.ts``
     - 9
     - 幹事の表示名の優先順位、筆頭の分離、公開用に渡す項目の絞り込み
     - SCR-ORG-01 / SCR-PUB-03
   * - ``tests/unit/organizer-profile.test.ts``
     - 36
     - プロフィールの入力検証（URL のホスト・ジャンル・文字数）、公開条件、実績の数え方、表示の短縮
     - SCR-ORG-07 / SCR-PUB-03
   * - ``tests/unit/participant-calendar.test.ts``
     - 13
     - 参加者カレンダーの日付の決め方、1 日 3 行への収め方、欠席の見せ方、主催者と参加者の遷移先
     - SCR-PUB-04
   * - ``tests/unit/public-organizer-page.test.ts``
     - 30
     - 主催者ページの掲載条件、開催日の絞り込みと並び順、満員の色、公開 URL の組み立て
     - SCR-PUB-03
   * - ``tests/unit/rsvp-status.test.ts``
     - 13
     - 出欠の選択肢（出席・参加要望）と残席、席を確保済みの人の扱い、待ち順の決め方
     - SCR-PUB-04
   * - ``tests/unit/design-scope.test.ts``
     - 8
     - パスから貼り紙の装飾スコープ（影だけ・静かめ・なし）を決める。``/console`` は装飾なし、``/organizer/events/new`` だけ静かめから影だけへ移る
     - 全画面の共通レイアウト
   * - ``tests/unit/format.test.ts``
     - 10
     - 金額（``3,000円`` / ``¥3,000``）、保存形式の日付と月の見出し、日時の表記、壊れた値の据え置き、日本時間の今月の範囲（UTC の月末が翌月になる場合を含む）
     - 全画面の共通表示
   * - ``tests/unit/mock-sync.test.mjs``
     - 32
     - HTML の整形（script・Next の CSS リンク・コメントの除去、``lang`` と body のクラスの保持）、アセットの差し替え（``/_next/image``・``/samples``・``data:``）、内部リンクの対応付けと未知リンクの ``#``、``uiHash`` の一致と変化（改行が CRLF でも LF でも同じ）、同期要否（manifest 無し・ハッシュ不一致・一致・HTML 欠け）、目録の No の重複と ``page.tsx`` の実在、``--only`` の絞り込み、枠ページ（iframe・幅の切り替え・状態の表記・エスケープ・生成物の欠け）
     - 該当なし（検査）
   * - ``tests/integration/draft-publish.test.ts``
     - 4
     - 下書きの公開で枠を 1 回だけ消費する。二重公開は 409、枠切れは 402
     - SCR-ORG-02
   * - ``tests/integration/draft-save-preview-publish.test.ts``
     - 5
     - 下書き保存では枠を消費せず公開で消費する。上書き保存の可否と、402・409・404 の分かれ方
     - SCR-ORG-02 / SCR-ORG-05
   * - ``tests/integration/organizer-profile.test.ts``
     - 12
     - プロフィールの保存と公開、非公開に戻したときの扱い、退会者と UUID でない URL の 404
     - SCR-ORG-07 / SCR-PUB-03
   * - ``tests/integration/organizers.test.ts``
     - 4
     - プレビューの主催者名と共同主催の人数、ゲストの表示名、招待の使い切り
     - SCR-ORG-01
   * - ``tests/integration/public-organizer-page.test.ts``
     - 8
     - 主催者ページの API。未ログインは 403、対象の絞り込み、候補日の並び、満員の扱い
     - SCR-PUB-03
   * - ``tests/integration/waitlist.test.ts``
     - 7
     - 満員時の参加要望への読み替え、行ロックで最後の 1 席を 1 人に限る、待ち順の繰り上がり
     - SCR-PUB-04
   * - ``tests/integration/venue-suggestions.test.ts``
     - 2
     - 未登録の端末の候補を覚えて次回そのまま選べる。同じ会場は行を増やさず使用日時だけ進む。会員の候補は本人にだけ見え、他人は削除できない
     - SCR-ORG-02 / SCR-ORG-05

.. breakdown-start

件数の内訳は ``tests/unit/`` が 567、``tests/integration/`` が 69 です。``TEST_DATABASE_URL`` の無い環境では、``npm test`` が 567 件を実行して 69 件を skip します。

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
     - 3 状態で出る・出ない。**jsdom と Testing Library の導入が先**
   * - 7
     - 登録案内の 3 状態（未登録・登録済み・第三者）
     - ``tests/components/register-required.test.tsx``
     - 見出しの文言とリンク先
   * - 8
     - ブラウザ行程 2 本（会員登録、アカウントなしの出欠）
     - ``tests/e2e/``
     - ``npm run test:e2e``。**Playwright の導入が先**

6 と 7 を書く前に、``vitest.config.ts`` の ``include`` に ``**/*.test.tsx`` を足す必要があります。足さないと、ファイルを置いても 1 件も集められません。

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
* チラシの見た目（1080×1920 の描画は :doc:`/flyer/testing/index` の pytest）
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
