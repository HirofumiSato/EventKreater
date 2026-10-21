# システム要件定義書

## チラシファースト型 イベント紹介・告知ページ生成＆出欠管理基盤

### （Flyer-Embedded Event Page & Frictionless RSVP System Requirements）

## 1. システム概要とアーキテクチャ境界

### 1.1. システムの位置づけ

本システムは、先行して定義された「チラシ自動生成基盤」「権限管理＆段階的会員基盤（Lean RBAC）」および「利用枠・課金決済基盤」の3つのサブシステムと連携し、イベント主催者が最速で告知ページを公開し、参加者が摩擦ゼロで出欠を登録・照会できる実行基盤を提供する。

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        外部連携・周辺サブシステム                         │
├─────────────────────┬───────────────────────────┬──────────────────────┤
│  チラシ生成機能      │  課金・利用枠管理基盤       │  権限・会員基盤      │
│  (Flyer Generator)  │  (Billing & Quota Guard)  │  (Lean RBAC & Auth)  │
└──────────┬──────────┴─────────────┬─────────────┴──────────┬───────────┘
           │ Flyer ID / 画像URL       │ canCreateEvent認可      │ Organizer Session
           ▼                         ▼                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│          本機能：イベント紹介ページ生成＆出欠管理基盤                      │
│                                                                        │
│  【主催者領域】                                                         │
│    ├─ イベント作成・編集（チラシ連携 or 標準デザイン選択）                  │
│    └─ 主催イベント一覧ダッシュボード（入力7項目＋参加状況集計の可視化）     │
│                                                                        │
│  【参加者領域】                                                         │
│    ├─ ポスター埋め込み型 ファーストビュー告知ページ                      │
│    └─ 会員登録不要 出欠登録＆Cookie自動照会（参加可否＋名前＋コメント）     │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2. コア設計方針

1. **チラシ任意・ハイブリッド描画（Flyer-Optional Hybrid View）:**
   * 事前に生成された縦型チラシ（9:16画像）が存在する場合は、ファーストビュー上部にカード状の「ポスター埋め込み型」として配置する。
   * チラシがない場合でも、システム標準テンプレート（テーマカラー＋タイポグラフィによるアイキャッチ）で破綻なくページを即時公開できる。
2. **決定論的入力項目（Deterministic Event Metadata）:**
   * 主催者が入力する基本情報（催しの名前、開催日時、費用プラン、場所、雨天時対応、想定上限人数）を一貫したデータ構造として管理する。開催日時と費用プランはそれぞれ 1〜8 件である。チラシはポスターの制約で日時・費用が 1 件なので、プリフィル時は先頭の日時と先頭プランの費用へ流し込む。プラン名が空なら「標準」とする。
3. **完全匿名・ゼロフリクション出欠（Zero-Friction RSVP with Cookie）:**
   * 参加者は会員登録・ログイン不要。参加可否（参加/不参加）、名前（ニックネーム可）、追加コメントの3項目を入力するだけで出欠が確定する。
   * 確定時に暗号化トークンをブラウザCookieに発行・永続化し、同一端末からの再アクセス時には登録内容を自動復元して変更可能とする。
4. **関心事の分離（Separation of Concerns）:**
   * イベント作成APIの実行直前に課金認可ゲート `canCreateEvent(userId)` を呼び出し、無料枠（2回まで）または有料チケット/サブスクリプションの判定を外部委譲する。

---

## 2. 機能要件（Functional Requirements）

### 2.1. イベント作成・編集機能（FR-CREATE / FR-EDIT）

* **FR-CREATE-01（課金ゲート判定）:** 主催者がイベント新規作成を試みた際、システムは課金認可ゲート `canCreateEvent(userId)` をフックし、作成権限がない場合は課金モーダル表示ステータス（HTTP 402相当）を返す。
* **FR-CREATE-02（チラシ連携アセット選択）:**
  * 主催者が生成済みのチラシ一覧から任意のFlyerを選択して紐付けることができる。
  * チラシが選択された場合、チラシ生成時のメタ情報（タイトル、日時、会場等）をフォーム初期値として自動展開する。
  * 「チラシなし（標準デザイン）」を選択して作成することも許可する。
* **FR-CREATE-03（基本情報の入力・バリデーション）:** 以下を厳密に入力受付・検証する。開催日時と費用プランは複数件を持てる。
  1. `title`（催しの名前）: 必須、1〜100文字。
  2. `schedules`（開催日時）: 必須、1〜8件。各件は `eventDate`（YYYY-MM-DD の実在する日付）と `eventTime`（1〜50文字。例: `19:00〜22:00`）。同じ日付と時間の組は重複できない。
  3. `pricePlans`（費用プラン）: 必須、1〜8件。各件は `name`（プラン名、1〜50文字。例: `プランA`、`学生`）と `price`（費用文、1〜50文字。例: `3,000円 (1ドリンク付)`、`無料`）。プラン名はイベント内で重複できない。
  4. `location`（場所）: 必須、1〜150文字。
  5. `rain_policy`（雨天時対応）: 必須、選択式（`雨天決行` / `雨天中止` / `雨天順延` / `屋内開催`）。
  6. `capacity`（想定上限人数）: 任意、正の整数値（定員なしの場合は `null` 許容）。
  7. `rsvpDeadline`（申し込み期限）: 任意。日本時間の `YYYY-MM-DDTHH:mm`。空なら期限なし。この日時になると、`PUBLISHED` のままでも新規の出欠と変更を止める。取消はできる。一覧から外すためには使わない。基本7項目には数えない。
  * 一覧の並びと日付検索の代表日は、候補のうち最も早い `eventDate` を `events.sort_date` に持つ。日付検索は、いずれかの開催日が一致すればヒットする。
* **FR-EDIT-01（排他ロック連携）:** 既存イベントの編集画面を開く際は、先行設計の排他ロックAPIをコールし、他幹事の同時編集を防止する。

### 2.2. 主催者イベント一覧ダッシュボード（FR-DASHBOARD）

* **FR-DASHBOARD-01（一覧表示項目）:** 主催者が作成した過去〜現在のイベントを一覧表示し、各カード/行に以下の情報を網羅する。
  * 催しの名前（`title`）
  * 開催日時（先頭の候補。2件以上なら「ほかN件」）
  * 場所（`location`）
  * 費用プラン（1件ならプラン名と費用、複数ならプラン名を並べる）
  * 雨天対応（`rain_policy`）
  * 参加状況指標: 「現在の参加確定人数 / 想定上限人数（定員）」（例: `14 / 20名`）
  * チラシサムネイル（チラシ連携時のみ表示、未連携時は標準バッジ）
  * 公開ステータス（`DRAFT`: 下書き / `PUBLISHED`: 公開中 / `ARCHIVED`: 開催終了）
* **FR-DASHBOARD-02（主催者アクション）:**
  * 「公開ページを開く（URLコピー機能付き）」
  * 「出欠・参加者一覧を見る（出欠者の名前・コメント詳細画面へ遷移）」
  * 「イベントを編集する（排他ロック取得）」
  * 「イベントを複製して新規作成する（Clone API呼び出し）」

### 2.3. 一般公開のイベント告知ページ（FR-PUBLIC-PAGE）

* **FR-PUBLIC-PAGE-01（ポスター埋め込み型ファーストビュー）:**
  * チラシ画像が存在する場合、画面上部に縦型ポスター（9:16比率）をカード型コンテナとして中央配置する（最大高さ: 画面縦幅の $65\text{vh}$ に制限し、下部の出欠CTAが隠れない設計とする）。
  * チラシ画像がない場合、イベントタイトルを大きくあしらったグラデーション背景の標準ヘッダーカードを表示する。
* **FR-PUBLIC-PAGE-02（実用ユーティリティ情報ブロック）:** チラシ直下に、画像では操作できない以下の実用ブロックを配置する。
  * Googleカレンダー追加リンク生成ボタン
  * Google Maps連携リンク（`location` 文字列から動的生成）
  * 雨天対応バッジおよび定員残枠表示
* **FR-PUBLIC-PAGE-03（Sticky 出欠CTAバー）:** スマホ閲覧時、画面最下部に常時追従するフローティングバーを配置し、1タップで出欠入力フォームへスムーズスクロールさせる。

### 2.4. 参加者 出欠管理機能（FR-RSVP）

* **FR-RSVP-01（入力項目）:** 会員登録不要。参加可否、名前、コメントに加え、出席のときだけ日時と費用プランを1つずつ選ぶ。
  1. `status`（参加可否）: `ATTENDING`（参加） / `DECLINED`（不参加） の2択トグルボタン。
  2. `scheduleId`（出席する日時）: `ATTENDING` のとき必須。そのイベントの開催日時から1件。
  3. `pricePlanId`（費用プラン）: `ATTENDING` のとき必須。そのイベントの費用プランから1件。
  4. `name`（名前）: 必須、1〜50文字（ニックネーム可）。
  5. `comment`（追加コメント）: 任意、最大500文字。
  * `DECLINED` では日時とプランを保存しない。候補を削除したときは、その候補を選んでいた回答の選択だけを外す。
* **FR-RSVP-02（Cookie発行と再訪自動照会）:**
  * 出欠登録成功時、サーバーは推測不可能な暗号化出欠トークン（`rsvp_token`）をHTTP-only / SameSite=Lax Cookieとして発行する。
  * 参加者が同一ブラウザ・端末で同イベント告知ページに再アクセスした場合、システムはCookieから既存の回答（可否、名前、コメント）を自動取得し、フォームを「回答済み状態」として初期表示する。
  * 参加者は、申し込み期限前かつ `PUBLISHED` のあいだ、名前・可否・コメントを上書き変更できる。期限以降の新規登録と変更は拒否する。取消は期限後もできる。
* **FR-RSVP-03（段階的会員化導線）:** 出欠完了画面および再訪確認エリアに、「アカウントを作成すると、参加予定のイベントを一覧でまとめて管理できます」という案内バナーを提示する（アカウント昇格APIと連携）。

---

## 3. 非機能要件（Non-Functional Requirements）

| 区分 | 要件項目 | 仕様基準・目標値 | 実装アプローチ |
| :--- | :--- | :--- | :--- |
| **性能** | **LCP (Largest Contentful Paint)** | モバイル回線で **1.5秒以内** | チラシ画像はCDNエッジでWebP/AVIFに変換。LQIP（ぼかし低解像度プレビュー）をインラインSVG/Base64で初期描画。 |
| **性能** | **APIレスポンス** | 95%tile値 **150ms以内** | 出欠登録（POST RSVP）および公開告知参照（GET Event）のDBクエリをインデックス最適化。 |
| **可用性** | **トラフィック急増耐性** | 瞬間 1,000 req/sec | 公開告知の静的情報（タイトル、日時等）はCDN/キャッシュ可能とし、出欠動線のみを動的API化。 |
| **セキュリティ** | **回答改ざん防止** | 他者の回答を書き換え不可 | Cookieに保持する `rsvp_token` のハッシュ値をDB照合。他人の回答IDを推測しての更新を物理遮断。 |
| **プライバシー** | **参加者情報の秘匿** | 公開告知ページに参加者一覧を出さない | 公開告知取得APIは「合計参加人数」のみを返し、個人名やコメントは幹事認可トークン所持時のみ返却。 |
| **Cookie仕様** | **永続性と互換性** | 保存期間 **90日間** | `HttpOnly=true`, `Secure=true` (本番), `SameSite=Lax`, `Path=/events/{id}` により漏洩抑止。 |

---

## 4. 画面一覧（Screen Catalog）

本システムを構成する全画面・モーダルの一覧および責務定義である。

### 4.1. 画面一覧マトリクス

| 画面ID | 画面名称 | ルーティングURL（パス） | 主要アクター | 認可・状態条件 | 主要機能・構成要素 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SCR-PUB-01** | **一般公開イベント告知ページ 兼 出欠登録画面** | `/events/[id]` | 参加者（未登録/会員） | 公開（認証不要） | ・ポスター埋め込み型FV（9:16画像カード or 標準グラデ）<br>・開催7項目＆カレンダー/Mapリンク<br>・出欠登録フォーム（参加/不参加＋名前＋コメント）<br>・Cookie再訪自動判定・回答上書き更新<br>・Sticky出欠CTAバー<br>・会員化バナー |
| **SCR-PUB-02** | **会員登録・ログイン画面** | `/auth/register`<br>`/auth/login` | 参加者 / 主催者 | 公開（未認証時） | ・メールアドレス/パスワード認証<br>・登録済み出欠・幹事トークンのアカウント統合（Hydration）実行 |
| **SCR-PUB-03** | **参加者マイページ** | `/mypage` | 登録済み参加者 | 会員認証（JWT）必須 | ・参加予定イベント一覧<br>・過去参加イベント履歴<br>・出欠回答内容の確認・変更リンク |
| **SCR-ORG-01** | **主催者イベント一覧ダッシュボード** | `/organizer/events` | イベント主催者（幹事） | 主催者認証（JWT / 幹事Cookie） | ・主催イベントカード一覧（入力7項目、参加確定/定員数、ステータス、チラシサムネイル）<br>・「新規作成」「複製」「出欠確認」「編集」「公開URLコピー」アクション |
| **SCR-ORG-02** | **新規イベント作成画面** | `/organizer/events/new` | イベント主催者（幹事） | `canCreateEvent` 認可必須 | ・チラシ連携アセット選択トリガー<br>・基本7項目入力フォーム（催し名、日付、時間、費用、場所、雨天対応、定員）<br>・任意の申し込み期限<br>・入力プレビュー<br>・公開実行ボタン（`status = PUBLISHED`、`visibility = UNLISTED`） |
| **SCR-ORG-03** | **チラシ選択モーダル** | `Modal (SCR-ORG-02内)` | イベント主催者（幹事） | 主催者認証必須 | ・先行機能で生成したチラシ画像アセット一覧<br>・「このチラシを使用する」決定時に7項目を自動プリフィル<br>・「チラシなしで作成」選択肢 |
| **SCR-ORG-04** | **イベント公開完了モーダル** | `Modal (SCR-ORG-02内)` | イベント主催者（幹事） | イベント作成直後 | ・告知URLの表示・1クリッククリップボードコピー<br>・告知用QRコード表示・ダウンロード<br>・SNS（X/LINE）シェアリンク |
| **SCR-ORG-05** | **イベント編集画面（排他ロック）** | `/organizer/events/[id]/edit` | イベント主催者（幹事） | 排他ロック保持者のみ編集可 | ・編集画面を開くと排他ロックを取得（時間では失効しない）<br>・7項目と申し込み期限の編集<br>・複製した下書きだけ `PUBLISHED` にできる<br>・保存後はロックを解放して主催一覧へ戻る<br>・他幹事編集中時のブロッカー表示（閲覧のみ/強制引き継ぎ）<br>・ロック保持者本人の画面には残り時間を出さない |
| **SCR-ORG-06** | **参加者一覧・出欠管理画面** | `/organizer/events/[id]/participants` | イベント主催者（幹事） | 主催者認可必須（幹事権限） | ・出欠集計サマリー（参加数、不参加数、定員充足率）<br>・参加者詳細テーブル（名前、ステータス、コメント、回答日時、会員/未登録バッジ）<br>・CSVダウンロード<br>・出席者への参加費領収書発行（金額は幹事が入力。決済はしない） |
| **SCR-ORG-09** | **幹事向け領収書** | `/organizer/events/[id]/receipts/[participantId]` | イベント主催者（幹事） | 幹事権限 | ・領収書の表示と印刷<br>・再発行 |
| **SCR-PUB-04** | **参加者向け領収書** | `/events/[id]/receipt` | 参加者本人 | 出欠 Cookie または会員 | ・自分の領収書の表示と印刷 |
| **SCR-ORG-07** | **共同幹事招待・受諾画面** | `/invitations/[token]` | 招待された共同幹事 | 招待トークン有効時 | ・イベント概要表示<br>・「共同幹事として参加する」受諾ボタン<br>・受諾後の幹事権限Cookie発行 / アカウント統合 |
| **SCR-MOD-01** | **課金・プラン選択モーダル** | `Modal (全主催画面オーバーレイ)` | イベント主催者（無料枠消化者） | `canCreateEvent` = false時 | ・無料トライアル枠（2回）終了通知<br>・単発生成プラン（299円）購入ボタン<br>・月額使い放題プラン（980円/月）加入ボタン<br>・Stripe Checkout決済画面への遷移 |

---

### 4.2. 各画面の機能・レイアウト詳細仕様

#### ① SCR-PUB-01: 一般公開イベント告知ページ 兼 出欠登録画面
* **アクセス制御:** 完全オープン（ログイン不要、推測不能なイベントUUIDで保護）。
* **ファーストビュー（FV）仕様:**
  * ポスター埋め込み型カードコンテナ（CSS: `aspect-ratio: 9/16`, `max-height: 65vh`, `object-fit: contain`）。
  * 背景にはチラシ画像の平均明度に応じた柔らかなシャドウとアンビエントグラデーションを自動配置。
  * チラシ未設定時は、タイトルが大きく目立つシステム標準タイポグラフィカードを表示。
* **実用ユーティリティ仕様:**
  * 「カレンダーに追加」: Googleカレンダー登録用URL（`https://calendar.google.com/calendar/render?...`）および `.ics` ダウンロードリンクを動的生成。
  * 「地図を開く」: `location` 文字列をもとに Google Maps 検索リンクを展開。
* **出欠フォーム（Dynamic RSVP Box）挙動:**
  * **初回訪問時:** 「参加」「不参加」の大きな押し分けボタントグル ＋ 名前入力欄 ＋ コメント入力欄。
  * **再訪時（Cookie保持時）:** 画面上部に「✓ あなたは【参加】で回答済みです」のステータスバッジを表示。入力欄には前回の名前・コメントがプリフィルされ、文言は「回答を更新する」へ変化。

#### ② SCR-ORG-01: 主催者イベント一覧ダッシュボード
* **アクセス制御:** 主催者セッション（ログイン会員 または 初回作成時に発行された幹事Cookie）所持者のみ。
* **カード一覧表示要件:**
  * 各イベントカードに主催者が指定した7つの基本情報を漏れなく表示：
    1. 催し名（`title`）
    2. 開催日（`event_date`）
    3. 開催時間（`event_time`）
    4. 費用（`price`）
    5. 場所（`location`）
    6. 雨天対応（`rain_policy`: 「雨天決行」「雨天中止」などの色分けピルタグ）
    7. 参加状況: 「参加確定 14名 / 定員 20名」（定員超過時は警告カラー表示）
  * チラシサムネイル（縦型アスペクト比で縮小表示、未連携時はプレースホルダーアイコン）。
  * ステータスバッジ（下書き/公開中/終了）。
* **クイックアクション:**
  * 「公開URLをコピー（クリップボード）」
  * 「出欠者一覧（`SCR-ORG-06` へ遷移）」
  * 「編集（`SCR-ORG-05` へ遷移、ロック取得）」
  * 「このイベントを複製して作成（ワンクリック複製APIキック）」

#### ③ SCR-ORG-02 & SCR-ORG-03: 新規イベント作成画面 & チラシ選択モーダル
* **アクセス制御:** 画面遷移時および「公開する」ボタン押下時に `canCreateEvent` 認可を検証。不可時は `SCR-MOD-01` が前面起動。
* **チラシ連携フロー:**
  * 「チラシ一覧から選ぶ」ボタンを押下すると `SCR-ORG-03` がモーダル展開。
  * 先行のチラシ生成機能で過去に作成した生成画像がグリッド表示される。
  * チラシを選択すると、そのチラシ生成時のメタデータ（タイトル、開催日時、場所、費用、雨天対応、上限人数）がフォームの各インプットに一括流し込み（プリフィル）される。
  * 主催者はプリフィルされた内容を確認し、必要に応じて微修正や補足説明テキストを追加できる。

#### ④ SCR-MOD-01: 課金・プラン選択モーダル
* **トリガー条件:**
  * 無料トライアル枠（累計2回）を消費済みの主催者が新規イベントを作成しようとした瞬間。
* **表示要素:**
  * 「無料トライアル（2回分）をご利用いただきありがとうございました。」
  * **選択肢A（単発チケット）:** 「今回のイベントだけ公開する（299円）」→ Stripe Checkout（単発決済）へ遷移。
  * **選択肢B（月額サブスク）:** 「月額プランで無制限に使い放題（月額980円）」→ 初月案内＋Stripe Billing（定期購読）へ遷移。
* **決済完了後のハンドリング:** Stripe Webhookの成功通知を受け、即座に認可ステータスを更新し、元の作成画面で作成・公開を継続させる。

---

## 5. 画面遷移設計（UI & Screen Flow）

### 5.1. 主催者画面フロー（Organizer Flow）

```text
[主催者ダッシュボード SCR-ORG-01]
  │
  ├─ [新規イベント作成ボタン]
  │    │
  │    ▼
  │  [認可ゲート: canCreateEvent(userId)]
  │    ├─ (制限到達: 3回目以降 & 未課金) ──> [課金モーダル SCR-MOD-01]
  │    │                                       ├─ 単発 299円決済 ──> 認可OKへ復帰
  │    │                                       └─ 月額 980円加入 ──> 認可OKへ復帰
  │    └─ (認可OK: 無料枠残 or 課金済)
  │         │
  │         ▼
  │       [新規イベント作成画面 SCR-ORG-02]
  │         ├─ [チラシから作成] ──> [チラシ選択モーダル SCR-ORG-03]
  │         │                          └─ チラシ決定 ──> 7項目自動入力
  │         └─ [標準デザインで作成] ───────────────────> 7項目手動入力
  │         │
  │         ▼ [イベントを公開する]
  │       [公開完了モーダル SCR-ORG-04] ──> URLコピー / QRコード保存
  │
  ├─ [カードアクション: 出欠確認]
  │    │
  │    ▼
  │  [参加者一覧・出欠管理画面 SCR-ORG-06] ──> CSVエクスポート
  │
  ├─ [カードアクション: イベント編集]
  │    │
  │    ▼
  │  [排他ロック判定: POST /lock]
  │    ├─ (自ロック取得成功) ────> [編集画面 SCR-ORG-05 (編集可能)]
  │    └─ (他幹事ロック中) ──────> [編集画面 SCR-ORG-05 (ロック競合モーダル)]
  │                                   ├─ 閲覧モードで開く
  │                                   └─ 強制引き継ぎ(Takeover)を実行
  │
  └─ [カードアクション: コピー作成]
       │
       ▼ [POST /clone]
     [複製された新規下書きイベント作成] ──> [編集画面 SCR-ORG-05]
```

### 5.2. 参加者画面フロー（Participant Flow）

```text
[外部SNS (LINE / Instagram / X / ポスターQR)]
  │
  ▼
[一般公開イベント告知ページ 兼 出欠登録画面 SCR-PUB-01]
  │
  ├─ 【初回アクセス（Cookie未保持）】
  │    ├─ ポスター埋め込みFV（9:16画像カード）
  │    ├─ 開催概要7項目＋Googleカレンダー登録＋Google Maps
  │    ├─ 出欠フォーム（参加/不参加 選択 ＋ 名前 ＋ コメント入力）
  │    │     │
  │    │     ▼ [出欠を登録する (POST /rsvp)]
  │    └─ 暗号化 rsvp_token をCookieに発行 ＋ 完了状態表示
  │         │
  │         ▼ [会員化バナー押下]
  │       [会員登録画面 SCR-PUB-02] ──> 登録完了で過去参加履歴をアカウント統合(Hydrate)
  │                                      │
  │                                      ▼
  │                                    [参加者マイページ SCR-PUB-03]
  │
  └─ 【再訪時（Cookie保持）】
       ├─ ポスター埋め込みFV
       ├─ 出欠フォーム自動プリフィル
       │    ├─ 「あなたは【参加】で登録済みです」バッジ表示
       │    └─ 前回の名前・コメントが展開
       │
       ▼ [登録内容を変更する (POST /rsvp 上書き)]
     登録情報更新 ＋ 更新完了トースト表示
```

### 5.3. 公開告知ページ（SCR-PUB-01）のワイヤーフレームレイアウト

```text
+-------------------------------------------------------+
|  [Header] 共有ボタン / 主催者名                        |
+-------------------------------------------------------+
|  [Zone 1: ファーストビュー (FV)]                       |
|  +-------------------------------------------------+  |
|  |  [ポスター埋め込みカード (9:16 アスペクト比)]     |  |
|  |  ・チラシ生成機能の美麗ポスター画像               |  |
|  |  ・未設定時は標準スタイリッシュグラデーション     |  |
|  |  (CSS: max-height: 65vh, 中央配置, 角丸シャドウ)|  |
|  +-------------------------------------------------+  |
+-------------------------------------------------------+
|  [Zone 2: 催し概要 & アクションユーティリティ]        |
|  ■ 催しの名前: ○○○○ジャズライブ & クラフトビール    |
|  📅 開催日時（複数可。出席時に1つ選ぶ）               |
|     2026/11/20(金) 19:30〜22:30                       |
|     2026/11/21(土) 14:00〜16:00                       |
|  📍 場所: Jazz & Bar Amber [Google Mapsを開く]        |
|  💰 費用プラン（複数可。出席時に1つ選ぶ）             |
|     プランA  3,500円 (1D付)                           |
|     プランB  2,000円（学生）                          |
|  ☔ 雨天対応: 屋内開催                                |
|  👥 定員: 18 / 25名 (残り 7席)                        |
|  📝 補足: 初心者大歓迎のジャズセッションです。        |
+-------------------------------------------------------+
|  [Zone 3: 出欠登録・確認フォーム (Dynamic RSVP Box)]  |
|  ▼ 出欠を選択してください                             |
|  ┌──────────────────┐    ┌──────────────────┐  |
|  │   ● 参加する     │    │     不参加       │  |
|  └──────────────────┘    └──────────────────┘  |
|                                                       |
|  お名前 (ニックネーム可) *                            |
|  [ 田中 (ウッドベース担当)                          ] |
|                                                       |
|  追加コメント (任意)                                  |
|  [ 20時頃に少し遅れて合流します！アレルギー等はなし ] |
|                                                       |
|  [              出欠を登録・変更する                ] |
|  ※登録後も、この画面を再度開くことでいつでも変更可能  |
+-------------------------------------------------------+
|  [Zone 4: 段階的会員化プロモーション]                 |
|  💡 会員登録すると、参加予定イベントを一覧管理できます|
|  [ 無料でアカウント登録する (SCR-PUB-02) ]           |
+-------------------------------------------------------+
|  [Sticky Bottom Bar (画面スクロール時に画面最下部追従)]|
|  残り 7席 | [今すぐ出欠回答する (↓)]                   |
+-------------------------------------------------------+
```

---

## 6. データモデル設計（Data Schema）

先行の「権限基盤スキーマ」との互換性を完全に維持し、チラシ参照・出欠コメント・主催者入力7項目を網羅したPrismaスキーマ定義である。

### 6.1. Prisma スキーマ定義

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// 雨天対応の列挙型
enum RainPolicy {
  RAIN_OR_SHINE     // 雨天決行
  CANCEL_ON_RAIN    // 雨天中止
  POSTPONE_ON_RAIN  // 雨天順延
  INDOOR            // 屋内開催
}

// 出欠ステータスの列挙型
enum RsvpStatus {
  ATTENDING         // 参加
  DECLINED          // 不参加
}

// イベント公開ステータス
enum EventStatus {
  DRAFT             // 下書き
  PUBLISHED         // 公開中
  ARCHIVED          // 開催終了
}

// イベント基本エンティティ
model Event {
  id              String       @id @default(uuid())
  title           String       @db.VarChar(100)       // 催しの名前
  sortDate        DateTime     @db.Date               // 最も早い開催日
  schedules       EventSchedule[]                    // 開催日時 1〜8件
  pricePlans      EventPricePlan[]                   // プラン名と費用 1〜8件
  location        String       @db.VarChar(150)       // 開催場所
  rainPolicy      RainPolicy   @default(RAIN_OR_SHINE)// 雨天時の対応
  capacity        Int?                                // 想定上限人数（null=定員なし）
  
  description     String?      @db.Text               // 補足説明テキスト
  status          EventStatus  @default(PUBLISHED)
  
  // チラシ生成機能との疎結合参照（任意）
  flyerAssetId    String?      @db.VarChar(64)        // 先行チラシ機能のアセットID
  flyerImageUrl   String?      @db.Text               // チラシ画像CDN配信URL (WebP)
  flyerLqip       String?      @db.Text               // 低解像度プレビュー (Blur-up用 Base64)

  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  // リレーション
  organizers      EventOrganizer[]
  rsvps           Rsvp[]
  editLock        EventEditLock?

  @@index([eventDate])
  @@index([status])
  @@map("events")
}

// 出欠登録エンティティ（参加者）
model Rsvp {
  id              String       @id @default(uuid())
  eventId         String
  
  status          RsvpStatus   // ATTENDING / DECLINED
  userName        String       @db.VarChar(50)        // 参加者氏名（ニックネーム可）
  comment         String?      @db.VarChar(255)       // 追加コメント欄

  // 端末照会用セキュリティトークン（SHA-256ハッシュでDB保持）
  tokenHash       String       @db.Char(64)
  
  // 段階的会員化用（会員登録時にUserとバインド、未登録時はnull）
  userId          String?
  
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  event           Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user            User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  // 1つの端末トークンは1イベントにつき1回答のみ
  @@unique([eventId, tokenHash])
  @@index([eventId, status])
  @@map("rsvps")
}

// 主催者リレーション（先行設計準拠）
model EventOrganizer {
  id              String       @id @default(uuid())
  eventId         String
  userId          String?      // 会員主催者ID
  guestTokenHash  String?      @db.Char(64) // ゲスト幹事トークンハッシュ
  role            String       @default("OWNER") // OWNER / CO_ORGANIZER
  createdAt       DateTime     @default(now())

  event           Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user            User?        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([guestTokenHash])
  @@map("event_organizers")
}

// 排他編集ロック（先行設計準拠）
model EventEditLock {
  eventId         String       @id
  lockedByUserId  String?
  lockTokenHash   String       @db.Char(64)
  expiresAt       DateTime
  createdAt       DateTime     @default(now())

  event           Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@map("event_edit_locks")
}

// ユーザー基盤（先行設計準拠）
model User {
  id              String       @id @default(uuid())
  email           String       @unique
  name            String
  passwordHash    String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  organizedEvents EventOrganizer[]
  rsvps           Rsvp[]

  @@map("users")
}
```

---

## 7. API境界・インターフェース仕様（API Boundary）

### 7.1. 課金認可ゲート インターフェース（外部呼び出し契約）

イベント作成API実行時、サービス層は以下の契約で課金基盤を呼び出す。

```typescript
interface BillingQuotaService {
  /**
   * イベント作成が可能かを判定し、可能であれば枠を消費またはログを記録する
   * @param userId 主催者のユーザーID（未登録ゲスト時は仮トークン）
   * @returns 認可可否および拒否理由
   */
  canCreateEvent(userId: string): Promise<{
    allowed: boolean;
    reason?: 'TRIAL_AVAILABLE' | 'SUBSCRIPTION_ACTIVE' | 'PAID_TICKET_ACTIVE' | 'QUOTA_EXCEEDED';
    remainingFreeCount?: number;
  }>;
}
```

### 7.2. エンドポイント一覧

| メソッド | エンドポイントパス | 認可 | 関連画面 | 用途 |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/organizer/events` | 主催者（JWT / 幹事Cookie） | `SCR-ORG-01` | 主催イベント一覧取得（入力7項目＋集計値） |
| `POST` | `/api/v1/organizer/events` | 主催者（`canCreateEvent` 必須） | `SCR-ORG-02` | 新規イベントの作成（チラシ連携または標準） |
| `GET` | `/api/v1/public/events/:id` | 不要（公開） | `SCR-PUB-01` | 公開告知ページ用データ取得（参加者個人情報は非開示） |
| `POST` | `/api/v1/public/events/:id/rsvp` | 不要（Cookie発行） | `SCR-PUB-01` | 会員登録不要の出欠登録・上書き更新 |
| `GET` | `/api/v1/public/events/:id/rsvp/me` | 不要（Cookie照合） | `SCR-PUB-01` | 端末Cookieに基づく自身の出欠登録内容の自動照会 |
| `GET` | `/api/v1/organizer/events/:id/participants` | 主催者（幹事権限） | `SCR-ORG-06` | 主催者専用：出欠者一覧（名前・可否・コメント）の取得 |
| `POST` | `/api/v1/organizer/events/:id/lock` | 主催者（幹事権限） | `SCR-ORG-05` | 排他編集ロック取得・再確認・強制引き継ぎ |
| `DELETE`| `/api/v1/organizer/events/:id/lock` | 主催者（ロック保持者） | `SCR-ORG-05` | 排他編集ロックの明示的解放 |
| `POST` | `/api/v1/organizer/events/:id/clone` | 主催者（幹事権限） | `SCR-ORG-01` | 過去イベントのワンクリック複製 |

### 7.3. 主要APIスキーマ詳細

#### ① イベント新規作成: `POST /api/v1/organizer/events`
##### Request Body (JSON)
```json
{
  "title": "金曜夜のジャズセッション & クラフトビール",
  "eventDate": "2026-11-20",
  "eventTime": "19:30〜22:30 (開場 19:00)",
  "price": "3,500円 (1ドリンク・チャージ込)",
  "location": "Jazz & Bar Amber（新宿区歌舞伎町1-xx）",
  "rainPolicy": "INDOOR",
  "capacity": 25,
  "description": "初心者大歓迎のジャズセッションです。楽器持ち込み自由。",
  "flyerAssetId": "flyer_asset_98765"
}
```
##### Response (201 Created)
```json
{
  "success": true,
  "event": {
    "id": "evt_abc12345",
    "title": "金曜夜のジャズセッション & クラフトビール",
    "publicUrl": "http://localhost:3000/events/evt_abc12345",
    "status": "PUBLISHED"
  }
}
```
##### Error Response (402 Payment Required: 無料枠枯渇時)
```json
{
  "type": "https://example.com/probs/quota-exceeded",
  "title": "Event Creation Limit Reached",
  "status": 402,
  "detail": "無料トライアル枠（2回）が終了しました。イベントを作成するには単発購入（299円）または月額プラン（980円）の登録が必要です。",
  "pricingOptions": {
    "singleTicket": { "price": 299, "currency": "JPY" },
    "subscription": { "price": 980, "currency": "JPY", "interval": "month" }
  }
}
```

#### ② 主催者イベント一覧取得: `GET /api/v1/organizer/events`
##### Response (200 OK)
```json
{
  "events": [
    {
      "id": "evt_abc12345",
      "title": "金曜夜のジャズセッション & クラフトビール",
      "eventDate": "2026-11-20",
      "eventTime": "19:30〜22:30 (開場 19:00)",
      "price": "3,500円 (1ドリンク・チャージ込)",
      "location": "Jazz & Bar Amber（新宿区歌舞伎町1-xx）",
      "rainPolicy": "INDOOR",
      "capacity": 25,
      "attendingCount": 18,
      "declinedCount": 2,
      "status": "PUBLISHED",
      "hasFlyer": true,
      "flyerImageUrl": "https://cdn.example.com/flyers/flyer_asset_98765.webp",
      "createdAt": "2026-10-18T10:00:00Z"
    }
  ]
}
```

#### ③ 公開告知ページ取得: `GET /api/v1/public/events/:id`
##### Response (200 OK)
```json
{
  "id": "evt_abc12345",
  "title": "金曜夜のジャズセッション & クラフトビール",
  "eventDate": "2026-11-20",
  "eventTime": "19:30〜22:30 (開場 19:00)",
  "price": "3,500円 (1ドリンク・チャージ込)",
  "location": "Jazz & Bar Amber（新宿区歌舞伎町1-xx）",
  "rainPolicy": "INDOOR",
  "capacity": 25,
  "attendingCount": 18,
  "isFull": false,
  "description": "初心者大歓迎のジャズセッションです。楽器持ち込み自由。",
  "flyer": {
    "exists": true,
    "displayMode": "POSTER_EMBEDDED",
    "imageUrl": "https://cdn.example.com/flyers/flyer_asset_98765.webp",
    "lqip": "data:image/webp;base64,UklGRlIAAABXRUJQVlA4..."
  }
}
```

#### ④ 一般出欠登録・更新: `POST /api/v1/public/events/:id/rsvp`
##### Request Body (JSON)
```json
{
  "status": "ATTENDING",
  "userName": "田中 (ベース担当)",
  "comment": "ウッドベースを持参します。20分ほど遅れますがよろしくお願いします！"
}
```
##### Response (200 OK)
```http
HTTP/1.1 200 OK
Set-Cookie: rsvp_token=tok_sec_99a8b7c6d5e4; Path=/events/evt_abc12345; Max-Age=7776000; HttpOnly; SameSite=Lax; Secure
Content-Type: application/json

{
  "success": true,
  "rsvp": {
    "status": "ATTENDING",
    "userName": "田中 (ベース担当)",
    "comment": "ウッドベースを持参します。20分ほど遅れますがよろしくお願いします！",
    "updatedAt": "2026-10-18T12:00:00Z"
  }
}
```

#### ⑤ 自身の出欠再訪照会: `GET /api/v1/public/events/:id/rsvp/me`
##### Response (200 OK: 登録済みの場合)
```json
{
  "hasRsvped": true,
  "rsvp": {
    "status": "ATTENDING",
    "userName": "田中 (ベース担当)",
    "comment": "ウッドベースを持参します。20分ほど遅れますがよろしくお願いします！",
    "updatedAt": "2026-10-18T12:00:00Z"
  }
}
```

#### ⑥ 主催者向け参加者一覧閲覧: `GET /api/v1/organizer/events/:id/participants`
##### Response (200 OK)
```json
{
  "summary": {
    "capacity": 25,
    "attendingCount": 18,
    "declinedCount": 2
  },
  "participants": [
    {
      "id": "rsvp_101",
      "userName": "田中 (ベース担当)",
      "status": "ATTENDING",
      "comment": "ウッドベースを持参します。20分ほど遅れますがよろしくお願いします！",
      "isRegisteredMember": false,
      "createdAt": "2026-10-18T12:00:00Z"
    },
    {
      "id": "rsvp_102",
      "userName": "佐藤",
      "status": "DECLINED",
      "comment": "出張と重なってしまい伺えません。次回ぜひ！",
      "isRegisteredMember": true,
      "createdAt": "2026-10-18T13:15:00Z"
    }
  ]
}
```

---

## 8. 【参考】難易度順の参照フレームワーク

本システムの要件をさらに発展させ、将来的な機能拡張や大規模アクセスへ対応するための3段階の参照ソースである。

* **Step 1（基礎原理）: Fielding, Roy Thomas『Architectural Styles and the Design of Network-based Software Architectures』(REST & HATEOAS)**
  * *視座:* 参加者のステートレス性（Cookie＋トークン）と、主催者ダッシュボードの認可境界をRESTfulなリソースモデルとして美しく分離する基本原則。
  * *他分野との接続:* 身分証不要の私書箱システム、物理的な出欠整理券。
* **Step 2（実装・実践）: Martin Kleppmann『Designing Data-Intensive Applications』(Chapter 7: Transactions & Weak Isolation)**
  * *視座:* 会員登録不要の出欠登録における「同一端末からの短時間二重送信（Race Condition）」および「定員超過（Write Skew / Over-booking）」を防ぐためのアトミックトランザクション設計。
  * *他分野との接続:* 航空券の空席仮押さえ、チケット予約システムの在庫引き当てアルゴリズム。
* **Step 3（最先端の限界）: Vercel / Google Chrome Team『Core Web Vitals and Image Delivery Optimization at Edge』**
  * *視座:* 縦型画像（9:16ポスター）をファーストビューに配置した際のCLS（レイアウトシフト）ゼロ化、およびEdge Workerを用いたLQIP/AVIFアダプティブ配信。
  * *他分野との接続:* 放送技術におけるプログレッシブ走査および低遅延動画ストリーミング。