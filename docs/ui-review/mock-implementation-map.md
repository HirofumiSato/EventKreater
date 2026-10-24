# モックと実装の対応表

モック 29 画面と実装の各ページを 1 画面 1 行で結ぶ台帳です。
移行のたびに、この表の「状態」と各節を更新します。

- ドキュメントの入口: `docs/index.rst` の「UI 監査」
- モックの目録: `style-guide/mock-screens-data.js`
- 検査: `npm run ui:map`

## この表の読み方

### 変えてよいもの

- `className`、要素の入れ子、ラッパー要素
- 見出し階層（`h1` → `h2` → `h3` の付け替え）
- モック由来の新しい表示構造（`event-card`、`progress-card`、`fold`、`roster`、`cal`、`ledger` など）
- 表示専用の文言・補助ラベル（`screen-note`、`help`、`eyebrow`）

### 変えてはいけないもの

- `fetch` の URL・メソッド・body、`router.push` / `router.replace` の行き先
- `href`、`<Link>` の遷移先、`target` / `rel`
- フォーム項目（`name`、`id`、`type`、`required`、`maxLength`、`minLength`、`inputMode`、`autoComplete`）
- イベントハンドラ（`onClick`、`onChange`、`onSubmit`、`onSave` など）と、その副作用
- 表示条件（`isDraft`、`role === "OWNER"`、`capacity !== null`、`receiptId` など）
- `aria-*` の意味（`aria-pressed`、`aria-expanded`、`aria-current`、`aria-label`、`role`）
- 確認・削除・公開・購入のモーダル、トースト、エラー表示

### スコープ

| 値 | 意味 | 見た目 |
| --- | --- | --- |
| `pop` | 影だけ（導入） | `deco--tape-shadow`。枠線なし、硬い 3px の影、0.5 度の傾き、暖色のアクセント、16px 方眼 |
| `quiet` | 静かめ（管理） | `deco--tape-quiet`。1px の枠線、`0 1px 2px` の淡い影、傾きなし、数字は等幅 |
| `-` | 対象外 | `/console/**`。装飾を比べる画面ではないためモックを持たない |

### 状態

`未着手` → `移行中` → `検証済`。`保留` は、モックに寄せると実装機能を落とすため止めた画面です（理由を節に書く）。

## 対応表

### 公開（7 画面）

| No | 画面 | mockファイル | 実装パス | page.tsx | 主な子コンポーネント | スコープ | 必要な状態・データ | 移行単位 | 状態 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | ホーム | mock-home.html | `/` | src/app/page.tsx | SiteChrome, WithdrawnNotice | pop | なし（静的） | 1画面 | 検証済 |
| 02 | サービスと料金 | mock-service.html | `/service` | src/app/service/page.tsx | SiteChrome | pop | buildServicePlans, loadActiveCampaigns, quoteBoth | 1画面 | 検証済 |
| 03 | 利用規約 | mock-terms.html | `/terms` | src/app/terms/page.tsx | SiteChrome | pop | 静的条文（目次アンカー） | 1画面 | 検証済 |
| 04 | イベント告知・出欠 | mock-event.html | `/events/[id]` | src/app/events/[id]/page.tsx | PosterHero, EventMetaCard, DynamicRsvpBox, StickyRsvpBar, OrganizerInviteCard, LineShareButton | pop | 公開イベント、出欠、満員、締切後、ログイン済み | 1画面 | 検証済 |
| 05 | 参加費の領収書 | mock-event-receipt.html | `/events/[id]/receipt` | src/app/events/[id]/receipt/page.tsx | ReceiptSheet | pop | ReceiptView、印刷 | 1画面 | 検証済 |
| 06 | 主催者のプロフィール | mock-organizer-public.html | `/organizers/[userId]` | src/app/organizers/[userId]/page.tsx | OrganizerProfileView | pop | 公開/非公開プロフィール、タグ、リンク、実績 | 1画面 | 検証済 |
| 07 | 主催者の催し | mock-organizer-public-events.html | `/organizers/[userId]/events` | src/app/organizers/[userId]/events/page.tsx | OrganizerPageView | pop | 一覧/カレンダー切替、未ログインのロック | 1画面 | 検証済 |

### 認証・設定（6 画面）

| No | 画面 | mockファイル | 実装パス | page.tsx | 主な子コンポーネント | スコープ | 必要な状態・データ | 移行単位 | 状態 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 08 | 主催者のログイン・登録 | mock-register.html | `/auth/register` | src/app/auth/register/page.tsx | AuthEntryScreen, LoginChallengeForm | pop | mode, step=phone, step=login-code, next, Google | 1画面 | 検証済 |
| 09 | メールの確認 | mock-verify.html | `/auth/verify` | src/app/auth/verify/page.tsx | SiteChrome | pop | token, audience, next=phone/login | 1画面 | 検証済 |
| 10 | 参加者ログイン | mock-participant-login.html | `/participant/login` | src/app/participant/login/page.tsx | AuthEntryScreen | pop | mode, step=phone, next | 1画面 | 検証済 |
| 11 | 共同幹事の招待 | mock-invitation.html | `/invitations/[code]` | src/app/invitations/[code]/page.tsx | SiteChrome | pop | 招待プレビュー、loggedIn、受諾 | 1画面 | 検証済 |
| 12 | アカウント設定 | mock-account.html | `/account` | src/app/account/page.tsx | AccountInfoPanel, PhoneChangePanel, PasswordPanel, WithdrawPanel | pop | 会員プロフィール、isOrganizer | 1画面 | 検証済 |
| 13 | メールアドレスの確定 | mock-account-verify.html | `/account/email/verify` | src/app/account/email/verify/page.tsx | SiteChrome | pop | token、working/done/error/missing | 1画面 | 検証済 |

### 参加者（3 画面）

| No | 画面 | mockファイル | 実装パス | page.tsx | 主な子コンポーネント | スコープ | 必要な状態・データ | 移行単位 | 状態 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 14 | 参加者ホーム | mock-participant.html | `/participant` | src/app/participant/page.tsx | SiteChrome | pop | /user/profile, /user/participations?scope=upcoming | 1画面 | 検証済 |
| 15 | 参加カレンダー | mock-participant-calendar.html | `/participant/calendar` | src/app/participant/calendar/page.tsx | ParticipantCalendarView | pop | /user/calendar、月移動、日別一覧 | 1画面 | 検証済 |
| 16 | 参加履歴 | mock-participant-history.html | `/participant/history` | src/app/participant/history/page.tsx | SiteChrome | pop | status/scope/page の絞り込み、領収書導線 | 1画面 | 検証済 |

### 主催者（13 画面）

| No | 画面 | mockファイル | 実装パス | page.tsx | 主な子コンポーネント | スコープ | 必要な状態・データ | 移行単位 | 状態 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 17 | 主催一覧 | mock-organizer.html | `/organizer/events` | src/app/organizer/events/page.tsx | OrganizerTabs, EventCard, QuotaStatusBanner, VerifyPaymentBanner, StripePortalButton, PricingModal, EventLifecycleModal, OrganizerPagePreviewModal | quiet | 公開/停止の一覧、下書き件数、利用枠、未払い | 1画面 | 検証済 |
| 18 | 主催カレンダー | mock-organizer-calendar.html | `/organizer/calendar` | src/app/organizer/calendar/page.tsx | CalendarView | quiet | /organizer/events、月移動、日別一覧 | 1画面 | 検証済 |
| 19 | 売上 | mock-revenue.html | `/organizer/revenue` | src/app/organizer/revenue/page.tsx | OrganizerTabs, RevenueSummaryLedger | quiet | 期間絞り込み、合計、イベント別、未選択プラン | 1画面 | 検証済 |
| 20 | 売上の内訳 | mock-revenue-detail.html | `/organizer/events/[id]/revenue` | src/app/organizer/events/[id]/revenue/page.tsx | OrganizerTabs, RevenueSummaryLedger, RevenueAllocationSection | quiet | プラン別、開催回別、按分 | 1画面 | 検証済 |
| 21 | 新規イベント作成 | mock-create.html | `/organizer/events/new` | src/app/organizer/events/new/page.tsx | EventForm, FlyerGeneratePanel, FlyerSelectModal, QuotaStatusBanner, PricingModal | pop | 5ステップ、下書き保存、公開、ゲスト枠 | 1画面 | 検証済 |
| 22 | イベントの編集 | mock-edit.html | `/organizer/events/[id]/edit` | src/app/organizer/events/[id]/edit/page.tsx | EventForm, CoHostPanel, useEditLock, LockConflictModal, FlyerGeneratePanel | quiet | 排他ロック、共同幹事、保存、402 | 1画面 | 検証済 |
| 23 | 下書き一覧 | mock-drafts.html | `/organizer/events/drafts` | src/app/organizer/events/drafts/page.tsx | OrganizerTabs, EventLifecycleModal, Toast | quiet | status=DRAFT のみ、削除 | 1画面 | 検証済 |
| 24 | 下書きのプレビュー | mock-preview.html | `/organizer/events/[id]/preview` | src/app/organizer/events/[id]/preview/page.tsx | PreviewClient, PosterHero, EventMetaCard, QuotaStatusBanner | quiet | 下書き、公開、403/409/402 | 1画面 | 検証済 |
| 25 | 参加者名簿 | mock-roster.html | `/organizer/events/[id]/participants` | src/app/organizer/events/[id]/participants/page.tsx | ParticipantListTable, RevenueSummaryLedger, ReceiptIssueModal | quiet | 行内編集、CSV、絞り込み、リマインド、領収書 | 1画面 | 検証済 |
| 26 | 幹事向け領収書 | mock-receipt.html | `/organizer/events/[id]/receipts/[participantId]` | src/app/organizer/events/[id]/receipts/[participantId]/page.tsx | ReceiptSheet, ReceiptIssueModal | quiet | 再発行、印刷、未登録幹事 | 1画面 | 検証済 |
| 27 | 公開直後の案内 | mock-register-required.html | `/organizer/register-required` | src/app/organizer/register-required/page.tsx | SiteChrome | quiet | eventId、guest/registered/forbidden/not-found | 1画面 | 検証済 |
| 28 | 公開プロフィールの編集 | mock-organizer-profile.html | `/organizer/profile` | src/app/organizer/profile/page.tsx | OrganizerTabs, OrganizerProfileForm | quiet | 公開可否、肩書き、自己紹介、タグ、リンク | 1画面 | 検証済 |
| 29 | 主催者マイページ | mock-mypage.html | `/mypage` | src/app/mypage/page.tsx | QuotaStatusBanner, VerifyPaymentBanner, StripePortalButton, PricingModal | quiet | 直近3件、利用枠、プロフィール状態 | 1画面 | 検証済 |

## 公開画面

### 01 ホーム（`/`）

**実装の機能台帳**

- API 呼び出しなし。`WithdrawnNotice` だけがクライアント側で退会通知を読む。
- リンク: `SITE.nav.createEvent.href`（`/organizer/events/new`）を 2 か所、`SITE.nav.service.href`（`/service`）を 1 か所。
- データ: `capabilities` 6 行、`steps` 3 行、`SITE.tagline`、`SITE.cta.createEventFree`。

**モックに無い実装機能（保持する）**

- 機能 3 行（モック）に対し、実装は 6 行。**6 行を維持**し、`feature-row` の構造だけを当てる。
- `WithdrawnNotice`（退会直後の通知）。
- `SITE` 経由のラベル。文言を直書きしない。

**モックにしかない構造（移植する）**

- `hero--stage` + `hero__grid` / `hero__copy` / `hero__poster`（実装は既に同じ骨格。差分はクラスと `figcaption` の位置のみ）。
- `section__head` / `section__title` / `section__note`。
- `feature-list` / `feature-row__index`。
- `step-list` / `step-row`。
- `cta-band` / `cta-band__inner` / `btn--inverse`。

**クラス対応（mock → 既存）**

- `hero__title` → `hero__title`（同じ）
- `feature-row` → `feature-row`（同じ）
- `cta-band` → `cta-band`（同じ）
- 追加: `section__head` の入れ子（実装は `section__head` 未使用）

**リスク**

- 機能 6 行を 3 行に削ると情報が落ちる。**行数は実装優先**。
- `WithdrawnNotice` をヒーローの外へ出すと、退会通知の位置が変わる。`stack` の先頭を維持する。

**完了条件**

- 機能 6 行・手順 3 行・CTA 2 本が残っている。
- 390/1280 で横スクロールなし。

### 02 サービスと料金（`/service`）

**実装の機能台帳**

- サーバーコンポーネント。`loadActiveCampaigns(now)` → `quoteBoth` → `buildServicePlans`。
- 表示: `plans`（無料・単発・月額）ごとに `discountPercent`、`listPriceYen` の取り消し線、`campaignEndsAt`、`campaignName`。
- キャンペーン実施中は `alert alert--info` に終了日時を出す。
- リンク: 作成画面、主催者ログイン、`/terms`。
- `capabilities` 6 行（できること）。

**モックに無い実装機能（保持する）**

- キャンペーンの割引率・定価・終了日時の表示（モックは固定価格のみ）。
- `capabilities` 6 行（モックは「料金に含まれるもの」4 行）。
- 「このページでは支払いは始まりません」の注記。

**モックにしかない構造（移植する）**

- `plan-list` / `plan-card` / `plan-card--pick` / `plan-card__name` / `plan-card__price` / `plan-card__list`。
- `rows` / `rows__item` / `rows__main` / `rows__title` / `rows__meta` / `rows__value`。
- `fold` / `fold__summary` / `fold__body`（よくある質問）。
- `notice`（要約帯）。

**クラス対応（mock → 既存）**

- `card-grid` + `card` → `plan-list` + `plan-card`。
- `panel__title`（できること）→ `section__title`。
- `stat__value`（価格）→ `plan-card__price`。

**リスク**

- 割引の取り消し線と終了日時は、`plan-card` の `small` に入れると読みにくい。`help` 行として独立させる。
- FAQ は実装に存在しない。**新規追加**してよいが、条文の正は `/terms`。重複を避けて要約に留める。

**完了条件**

- 3 プラン・割引表示・終了日時・`/terms` リンクが残っている。

### 03 利用規約（`/terms`）

**実装の機能台帳**

- 静的。`SECTIONS` の目次アンカー（`#applicability` など）と本文。
- リンク: 目次 → 各節、`/service`。
- `UPDATED_AT` の表示。

**モックに無い実装機能（保持する）**

- 目次（`nav.panel` + アンカー）。モックは目次を持たない。**保持**。
- 条文の番号と内容（第1条〜）。モックの条文とは章立てが違う。**実装の条文を正**とする。

**モックにしかない構造（移植する）**

- `legal`（条文の組版）。見出し `h2` と `p` / `ol` / `ul` の間隔。
- `notice`（要約帯）。
- `screen-note`（制定日・最終改定）。

**クラス対応（mock → 既存）**

- `section.stack` + `panel__title` → `legal` + `h2`。
- `card__body` → `legal p`。

**リスク**

- 目次を `legal` の外に出すと、アンカーの位置がずれる。`id` は節に残す。

**完了条件**

- 目次のアンカーがすべて解決する。条文が欠けていない。

### 04 イベント告知・出欠（`/events/[id]`）

**実装の機能台帳**

- `EventPageClient` が `/api/v1/public/events/[id]` を取得。
- 構成: `PosterHero` → `EventMetaCard` → `LineShareButton` → `DynamicRsvpBox` → `OrganizerInviteCard` → 領収書リンク（`receiptId` があるとき） → 履歴リンク → ログイン導線 → `StickyRsvpBar`。
- `DynamicRsvpBox`: 出席/欠席/参加要望、ニックネーム、人数、費用プラン、ひとこと、再訪時の復元、満員時の待ち順、締切後の表示、回答後の変更。
- `StickyRsvpBar`: 画面下部の固定 CTA。
- OGP は `generateMetadata` が DB から生成。

**モックに無い実装機能（保持する）**

- 回答後の取り消し・変更、再訪照会（同じブラウザでの復元）。
- 費用プランの選択 UI（モックは金額表示のみ）。
- 開催日が複数ある場合の選択。
- 締切後・受付停止（`CLOSED`）の表示。
- 主催者・共同主催者の名前表示（`EventMetaCard`）。
- 参加要望の待ち順。

**モックにしかない構造（移植する）**

- `poster-hero` / `poster-hero__image` / `poster-hero__stamp`。
- `event-sheet` / `event-sheet__title` / `event-sheet__host` / `event-sheet__badges` / `event-facts` / `event-facts__row`。
- `rsvp` / `rsvp__title` / `rsvp__choices` / `rsvp__choice` / `rsvp__foot`。
- `sticky-cta`。
- `org-invite`。

**クラス対応（mock → 既存）**

- `poster-hero` → 既存 `PosterHero` のクラスを維持し、`poster-hero__stamp` を追加。
- `event-facts` → 既存 `EventMetaCard` の `meta-list` を `event-facts` へ。
- `rsvp__choice` → `DynamicRsvpBox` の選択ボタン。
- `sticky-cta` → 既存 `StickyRsvpBar`。

**リスク**

- モックは `data-chrome="bare"` で共通ヘッダーを外しているが、実装は `/console` 以外でヘッダーを出す。**UX は実装優先**なのでヘッダーは残す。
- `DynamicRsvpBox` の状態遷移（回答前 / 回答後 / 満員 / 締切後）は最も壊れやすい。**マークアップだけ**を替える。
- `StickyRsvpBar` は `paddingBottom: 4.5rem` と対。片方だけ変えると本文が隠れる。

**完了条件**

- 出欠の送信・変更・復元が動く。満員と締切後の分岐が残っている。
- ヘッダーと `StickyRsvpBar` の両方が出る。

### 05 参加費の領収書（`/events/[id]/receipt`）

**実装の機能台帳**

- `/api/v1/public/events/[id]/receipt` を取得し、`ReceiptSheet` を描画。
- `ReceiptSheet`: 宛名、金額、但し書き、催し名、発行日、発行者、印刷ボタン（`window.print()`）。
- 告知へ戻るリンク（`no-print`）。

**モックに無い実装機能（保持する）**

- 取得失敗時の `alert alert--error`。
- 読み込み中の `loading`。

**モックにしかない構造（移植する）**

- `receipt-sheet` / `receipt-sheet__title` / `receipt-sheet__no` / `receipt-sheet__to` / `receipt-sheet__amount` / `receipt-sheet__lines` / `receipt-sheet__line` / `receipt-sheet__foot`。
- `page-title` / `page-lead`（印刷時は非表示）。

**クラス対応（mock → 既存）**

- `receipt` → `receipt-sheet`。`receipt__title` → `receipt-sheet__title` など。
- `no-print` は既存を維持。

**リスク**

- 印刷は主目的。`@media print` で影・地紋・ヘッダー・フッターを落とす。
- 領収書番号は実装の `ReceiptView` に無い場合がある。**無い項目はモックから足さない**（`receiptId` があるときだけ出す）。

**完了条件**

- 印刷プレビューで領収書だけが出る。金額・宛名・但し書きが実データ。

### 06 主催者のプロフィール（`/organizers/[userId]`）

**実装の機能台帳**

- `loadPublicOrganizerProfile`（`cache` で 1 リクエスト 1 回）。
- `generateMetadata`: 名前・自己紹介の抜粋・`robots: noindex`。
- `OrganizerProfileView`: `isPublished` で出し分け。公開時は肩書き・エリア・タグ・リンク・自己紹介・実績（催し数・開始年）。非公開時は名前と催しへの導線のみ。
- `eventsPath` で催しページへ。

**モックに無い実装機能（保持する）**

- `preview` モード（編集画面から非公開の内容を確認）。
- `profile.stats`（主催した催し数・活動開始年）。
- 非公開時の「まだプロフィールを公開していません」。

**モックにしかない構造（移植する）**

- `profile-head` / `profile-head__avatar` / `profile-head__name` / `profile-head__title`。
- `genre-chips` / `chip`。
- `kv` / `kv__row`。
- `profile-links`。
- 「これからの催し」「終わった催し」の `rows`（実装は催しページへの CTA のみ）。

**クラス対応（mock → 既存）**

- `profile-hero` → `profile-head`。
- `profile-tags` / `profile-tag` → `genre-chips` / `chip`。
- `profile-stats` → `kv`。

**リスク**

- モックの「これからの催し 2 件」は、実装が催し一覧 API を呼んでいない。**新規 fetch を足さない**。`panel` の CTA を `section__head` + `rows` 風に見せるに留める。
- `robots: noindex` を落とさない。

**完了条件**

- 公開/非公開・プレビューの 3 状態が崩れていない。`noindex` が残っている。

### 07 主催者の催し（`/organizers/[userId]/events`）

**実装の機能台帳**

- `/api/v1/public/organizers/[userId]/events`。
- 一覧 / カレンダーの切替（`segment`、URL クエリ）。
- 月移動（前月・翌月・今月）、日付選択、日別の催し。
- 未ログイン時は `organizer-locked`（骨組みをぼかし、ログインへ）。
- 各催し: タイトル、日時、場所、費用、残席/満員/参加要望、詳細へのリンク。
- プロフィールへ戻るリンク、参加者ホームへ。

**モックに無い実装機能（保持する）**

- カレンダー表示（モックは切替 UI のみで一覧だけ）。
- 残席数・満員・参加要望受付中のバッジ。
- 未ログインのロック表示と `next` 付きログイン導線。

**モックにしかない構造（移植する）**

- `roster-toolbar` / `segment`。
- `rows` / `rows__item` による催し一覧。
- `section__head`。

**クラス対応（mock → 既存）**

- `segment` は既存を維持（実装は `label` + `radio`）。モックの `button` + `aria-pressed` へ**変えない**（URL クエリと連動しているため）。
- `card`（一覧）→ `rows`。

**リスク**

- `segment` をボタン化すると、クエリ連動と `aria` の意味が変わる。**実装の `label` + `radio` を維持**し、見た目だけモックへ寄せる。
- カレンダーの `calendar__*` とモックの `cal__*` は別物。**この画面は実装の `calendar__*` を維持**し、`cal` へ寄せない（07 は一覧が主、カレンダーは従）。

**完了条件**

- 一覧/カレンダーの切替、月移動、ロック表示、残席バッジが残っている。

## 認証・設定画面

### 08 主催者のログイン・登録（`/auth/register`）

**実装の機能台帳**

- `AuthEntryScreen audience="organizer"`。
- `mode`（register/login）の `segment`。
- フォーム: 名前（登録時のみ）、メール、パスワード（登録時 8 文字以上）。
- `POST /api/v1/auth/local`（`action` は mode 依存）。
- Google: `/api/v1/auth/google?audience=organizer`（`next` 付き）。
- `step=phone`: `PhoneScreen`（`/auth/phone/start`、`/auth/phone/confirm`、再送、`CODE_EXHAUSTED`）。
- `step=login-code`: `LoginChallengeForm`。
- `EMAIL_UNVERIFIED` → 確認メール再送（`/api/v1/auth/verification`）。
- `ADMIN_CONSOLE_REQUIRED` → `/console/login` への導線。
- 既存セッションの判定（`useExistingSession`）と着地（`resolveSessionDestination`）。
- `next`、`switch`、`error` クエリ。

**モックに無い実装機能（保持する）**

- 新規登録 / ログインの切替。
- 確認メール再送、管理者ログイン導線、`switch=1`（共用端末）。
- Google のエラー文言（`GOOGLE_ERRORS`）。

**モックにしかない構造（移植する）**

- `auth-card` / `auth-card__title` / `auth-card__note` / `auth-card__body`。
- `auth-alt`。
- `code-input`。
- `page--form`。

**クラス対応（mock → 既存）**

- `form` + `field` は既存を維持。
- `panel` → `auth-card`。
- `segment` は既存（`radio`）を維持。

**リスク**

- `segment` を `button` にすると `checked` 連動が壊れる。**`radio` を維持**。
- `PhoneScreen` は同じページ内の別ステップ。モックの「電話番号で入る」カード 2 枚と混同しない。**ステップは分けたまま**。

**完了条件**

- 登録・ログイン・電話確認・確認コード・Google・再送がすべて動く。

### 09 メールの確認（`/auth/verify`）

**実装の機能台帳**

- `token` クエリ、`audience` クエリ（`participant` なら参加者入口へ）。
- `POST /api/v1/auth/verify` → `body.next` が `phone` なら `?step=phone` へ `router.push`。
- 状態: `idle` / `pending` / `done` / `error`。
- `window.history.replaceState` でトークンを消す。

**モックに無い実装機能（保持する）**

- 確認ボタンを押す前の `idle`（モックは「確認済み」の静的表示）。
- `audience=participant` の分岐。
- `token` が無いときのボタン無効化。

**モックにしかない構造（移植する）**

- `alert alert--success`（確認済み）。
- `auth-card`（電話番号の確認への案内）。
- `page--form`。

**クラス対応（mock → 既存）**

- `btn--primary btn--block` → 既存を維持。

**リスク**

- 自動確認にしない。**ボタンを押して確認**する実装を維持（メールスキャナの先読み対策）。

**完了条件**

- 参加者 / 主催者の両方で着地が正しい。トークンが URL から消える。

### 10 参加者ログイン（`/participant/login`）

**実装の機能台帳**

- `AuthEntryScreen audience="participant"`（08 と共通）。
- 着地は `/participant`、切替リンクは `/auth/register`。

**モックに無い実装機能（保持する）**

- 08 と同じ全機能（登録・ログイン・電話確認・Google・再送）。

**モックにしかない構造（移植する）**

- `auth-card` 2 枚（電話番号 / 確認番号）の**見た目**を `PhoneScreen` に当てる。

**クラス対応（mock → 既存）**

- 08 に同じ。

**リスク**

- モックは「パスワードは要りません」と書くが、実装はメール + パスワードも受ける。**実装の選択肢を消さない**。文言は「電話番号でも入れます」に寄せる。

**完了条件**

- 参加者入口の着地が `/participant`。主催者入口への切替が残る。

### 11 共同幹事の招待（`/invitations/[code]`）

**実装の機能台帳**

- `GET /api/v1/invitations/[code]`（催し・主催・開催・場所・費用・雨天・有効期限・`loggedIn`）。
- `POST /api/v1/invitations/[code]` → `manageUrl` へ `router.push`。
- 未ログイン時は会員登録 / ログインへ（`next` 付き）。

**モックに無い実装機能（保持する）**

- `loggedIn` による出し分け。
- `manageUrl` への遷移。
- 有効期限の表示。

**モックにしかない構造（移植する）**

- `auth-card`。
- `kv`（開催 / 場所 / 費用 / 雨天）。できること・できないことは、実装が保証する範囲（編集と名簿の分担、利用枠を消費しない）だけを `auth-card__note` に書く。

**クラス対応（mock → 既存）**

- `meta-list` → `kv`。
- `btn--block` は既存。
- 受諾・未ログイン導線は `panel__actions` に置く。

**リスク**

- モックの「断る」は実装に無い。**新規の API を足さない**。`/organizer/events` へのリンクで代替する。

**完了条件**

- 受諾・未ログイン導線・エラーが残っている。

### 12 アカウント設定（`/account`）

**実装の機能台帳**

- `/api/v1/user/profile`（401 は `/auth/login?next=/account`）。
- `AccountInfoPanel`（表示名・メール変更、確認待ちの表示）。
- `PhoneChangePanel`（電話番号変更、確認コード）。
- `PasswordPanel`（現在 / 新規パスワード）。
- `WithdrawPanel`（退会）。
- `isOrganizer` でマイページ / 参加者ホームへの導線を出し分け。

**モックに無い実装機能（保持する）**

- 確認待ちメールの表示と取り消し。
- 退会の確認モーダル。
- パスワード強度・漏えいチェックのエラー。

**モックにしかない構造（移植する）**

- `panel` + `panel__title` + `panel__note` + `panel__actions` の縦積み。
- `page--form`。
- 退会は `section` + `section__head`（見出しと罫線）へ分ける。

**クラス対応（mock → 既存）**

- 既存の `panel` をそのまま使い、`field` / `panel__actions` の間隔をモックに合わせる。
- `AccountInfoPanel` はモックに合わせて「表示名」と「メールアドレス」の 2 パネルへ分ける（ハンドラと API は変えない）。

**リスク**

- 4 つのパネルはそれぞれ独立した API を持つ。**1 つにまとめない**。

**完了条件**

- 表示名・メール・電話・パスワード・退会の 5 機能が残っている。

### 13 メールアドレスの確定（`/account/email/verify`）

**実装の機能台帳**

- `token` クエリで `POST /api/v1/user/email/confirm`。
- 状態: `working` / `done` / `error` / `missing`。
- `/account` と `/` へのリンク。

**モックに無い実装機能（保持する）**

- `missing`（トークンなし）と `error` の表示。
- 「他の端末のログインは解除されました」の注記。

**モックにしかない構造（移植する）**

- `alert alert--success`。
- `panel` + `rows`（次にやること）。

**クラス対応（mock → 既存）**

- 既存の `panel` を維持。

**リスク**

- 完了後に自動遷移しない（実装はその場に留まる）。**挙動を変えない**。

**完了条件**

- 4 状態が出る。`/account` へ戻れる。

## 参加者画面

### 14 参加者ホーム（`/participant`）

**実装の機能台帳**

- `/api/v1/user/profile`（401 は「ログインが必要です」+ 参加者ログイン）。
- `/api/v1/user/participations?scope=upcoming&limit=3`。
- `/api/v1/user/hydrate`（POST）。
- 統計 4 件（これからの参加 / 出席 / 参加要望 / 欠席）。
- 各参加: タイトル、出欠バッジ、日程・費用プラン・場所、コメント、出欠変更、領収書（`receiptId`）、主催者ページ（`ownerUserId`）。
- ログアウト（`/api/v1/auth/logout` → `/`）。
- 履歴への導線、ログイン不要の注記。

**モックに無い実装機能（保持する）**

- ログアウト。
- 主催者ページへのリンク。
- コメント表示。
- `hydrate` 呼び出し。

**モックにしかない構造（移植する）**

- `roster-summary` / `roster-summary__item` / `roster-summary__value`（統計 4 件）。
- `event-card`（次の催し 1 件）。
- `rows`（これからの参加）。
- 「主催する側でも使う」→ 実装の主催者導線に置き換える。

**クラス対応（mock → 既存）**

- `stat-grid` + `stat` → `roster-summary`。
- `card`（次に参加するイベント）→ `event-card`。
- モックの `roster-summary__item--money` は実装に「次の支払い」が無いので使わない。

**リスク**

- 統計は 4 件。モックの 5 件（次の支払い）は**足さない**（API に無い）。
- `event-card` のチラシ画像は、API が返すか確認してから使う。無ければ画像なしの `event-card` にする。

**完了条件**

- 4 統計・参加一覧・領収書・主催者リンク・ログアウトが残っている。

### 15 参加カレンダー（`/participant/calendar`）

**実装の機能台帳**

- `/api/v1/user/calendar`。
- 月移動、今月、日付選択。
- 日別一覧: 時刻、タイトル、出欠（`is-declined` / `is-waitlist`）、場所。
- 未ログインは警告 + 参加者ログイン。
- `/participant` へ戻る。

**モックに無い実装機能（保持する）**

- 月移動の `aria-live`、今日へのジャンプ。
- 出欠による行の色分け（`is-declined` / `is-waitlist`）。

**モックにしかない構造（移植する）**

- `cal` / `cal__head` / `cal__month` / `cal__nav` / `cal__weekday` / `cal__grid` / `cal__day` / `cal__legend`。

**クラス対応（mock → 既存）**

- `calendar__*` → `cal__*` へ**全面置換**（この画面はカレンダーが主）。
- セル内の短冊（催し名・`+N`・モーダル）は実装の機能なので残し、`cal__event` / `cal__more` としてモックの面に載せる。
- `calendar-day__item` の `is-declined` / `is-waitlist` は、`rows__item` + `badge` の出欠表示へ置き換える。

**リスク**

- セルの `is-today` / `is-outside` / `has-event` の条件を落とすと、日付の意味が消える。**条件は実装から写す**。
- 月移動の URL クエリを変えない。

**完了条件**

- 月移動・日付選択・出欠の色分けが残っている。

### 16 参加履歴（`/participant/history`）

**実装の機能台帳**

- `/api/v1/user/participations`（`scope` / `status` / `page` / `limit`）。
- `status` 4 種（すべて / 出席 / 参加要望 / 欠席）、`scope` 3 種（すべて / これから / 過去）。
- ページ送り（前へ / 次へ、`total` / `hasMore`）。
- 各行: タイトル、出欠、日程・プラン・場所、コメント、回答日、イベントを開く、領収書（`receiptId`）。
- 401 はログイン導線、`empty` は条件一致なし。

**モックに無い実装機能（保持する）**

- `scope` の絞り込み（モックは期間セレクトのみ）。
- ページ送り（モックは「さらに読み込む」）。
- 回答日の表示。

**モックにしかない構造（移植する）**

- `roster-toolbar` / `segment` / `roster-toolbar__search`。
- `rows` / `rows__item` / `rows__meta` / `rows__value`。

**クラス対応（mock → 既存）**

- `card`（履歴 1 件）→ `rows__item`。
- `segment` は既存の `radio` を維持（`checked` 連動）。
- モックの `<select>`（期間）は `scope` の `segment` に読み替える。**select を足さない**。

**リスク**

- `status` と `scope` は別軸。モックの 1 行セグメントにまとめると条件が消える。**2 段のまま**にする。
- ページ送りを「さらに読み込む」に変えると `page` クエリが壊れる。**前へ/次へを維持**。

**完了条件**

- 2 軸の絞り込み・ページ送り・領収書リンクが残っている。

## 主催者画面

### 17 主催一覧（`/organizer/events`）

**実装の機能台帳**

- `/api/v1/organizer/events`（全件。`DRAFT` は画面で分離）。`viewer` を保持。
- `OrganizerTabs`。
- `QuotaStatusBanner`（利用枠、購入モーダル）。
- `VerifyPaymentBanner`（決済確認）。
- `StripePortalButton`（契約管理）。
- `EventCard` × 公開中 / 停止（`onClone`、`onDelete`）。
- 下書き件数つきの「下書き一覧」導線。
- プロフィール表示 / 編集、催しページ、プレビュー、URL コピー。
- `EventLifecycleModal`（停止 / 削除）、`PricingModal`、`Toast`。
- `?registered=1` の完了トースト。

**モックに無い実装機能（保持する）**

- 利用枠バナー、未払い確認、Stripe ポータル。
- 複製・停止・削除・プレビュー・URL コピー。
- 下書き件数と導線。
- `role`（主催 / 共同主催）。

**モックにしかない構造（移植する）**

- `stat-grid`（公開中 / 回答待ち / 見込み売上）。
- `event-card` / `event-card__thumb` / `event-card__head` / `event-card__meter-label` / `meter`。
- `fold`（告知 URL / チラシ再生成 / 非公開化）。
- `org-subnav`。

**クラス対応（mock → 既存）**

- `OrganizerTabs` → `org-subnav` の見た目へ（リンクと `aria-current` は維持）。
- `card` → `event-card`。
- モックの `fold` 3 つは実装の「共有と設定」に相当。ただし操作は `EventLifecycleModal` 経由なので、**ボタンは既存のハンドラを呼ぶ**。

**リスク**

- `meter` は定員が無い催し（`capacity === null`）で幅を決められない。**定員なしは `meter` を出さない**。
- モックの「チラシを再生成」は一覧に無い（編集画面にある）。**新規 API を足さず**、編集画面へのリンクにする。
- `EventCard` の内部に `onClone` / `onDelete` がある。**カードごと置き換えず、クラスだけ当てる**。

**完了条件**

- 利用枠・未払い・複製・停止・削除・プレビュー・下書き導線がすべて残っている。

### 18 主催カレンダー（`/organizer/calendar`）

**実装の機能台帳**

- `/api/v1/organizer/events`。
- 月移動、今月、日付選択、日別一覧。
- 各催し: 時刻、タイトル、状態、参加数、名簿へのリンク。
- 空状態は作成画面へ。
- `/organizer/events` へ戻る。

**モックに無い実装機能（保持する）**

- 状態（公開中 / 下書き / 停止）の表示。
- 名簿への直接リンク。
- 空状態の CTA。

**モックにしかない構造（移植する）**

- `org-subnav`。
- `cal` 一式（`cal__day` の `has-event--draft` を含む）。
- `cal__legend`（公開中 / 下書き）。

**クラス対応（mock → 既存）**

- `calendar__*` → `cal__*` へ全面置換。
- `calendar-day__row` の状態 → `cal__day` の修飾。

**リスク**

- 状態ごとの凡例（公開中・下書き・停止）を落とさない。モックは 2 種だが実装は 3 種（`PUBLISHED` / `DRAFT` / `CLOSED`）。**3 種に増やす**。

**完了条件**

- 月移動・日付選択・状態表示・名簿リンクが残っている。

### 19 売上（`/organizer/revenue`）

**実装の機能台帳**

- `/api/v1/organizer/revenue`（`from` / `to`）。
- 期間: 全期間 / 今月 / 期間指定（`from` / `to` の date input）。
- `RevenueSummaryLedger`（見込み・発行額・差額・按分）。
- 未選択プランの警告と、該当催しの名簿へのリンク。
- イベント別テーブル（状態・出席/欠席・見込み・取り分・発行済み・差額、`role === "CO_HOST"`、`unreconciled < 0` の警告色）。
- 401 / `REGISTER_REQUIRED` の分岐。

**モックに無い実装機能（保持する）**

- 期間指定（date input）。
- 按分（`myShare`）。
- 共同主催の表示、差額のマイナス警告。
- 会員登録への導線。

**モックにしかない構造（移植する）**

- `org-subnav`。
- `ledger` / `ledger__row` / `ledger__row--total` / `ledger__label` / `ledger__note` / `ledger__value`。
- `rows`（催し別）。
- `panel`（プラン未選択）。

**クラス対応（mock → 既存）**

- `RevenueSummaryLedger` の内部を `ledger` へ。
- `data` テーブル → `rows`（ただし列が多いので、モックの `rows` には収まらない。**テーブルを維持**し `table-card` の見た目だけ当てる）。

**リスク**

- イベント別は 8 列。`rows` に畳むと列が消える。**テーブル維持**。
- 期間指定を「全期間 / 3か月 / 1年」の select に変えると `from`/`to` の任意指定が消える。**維持**。

**完了条件**

- 3 期間モード・按分・未選択プラン・会員登録導線が残っている。

### 20 売上の内訳（`/organizer/events/[id]/revenue`）

**実装の機能台帳**

- `/api/v1/organizer/events/[id]/revenue`。
- `RevenueSummaryLedger`。
- 未選択プランの警告。
- `RevenueAllocationSection`（`organizerCount > 1` のときだけ）。
- プラン別テーブル（プラン・対象・金額・人数・小計）。
- 開催回別テーブル（日時・出席・小計）。
- 名簿へ / 売上一覧へ。

**モックに無い実装機能（保持する）**

- 按分セクション（共同主催がいるとき）。
- `PRICE_AUDIENCE_LABELS`（対象）列。

**モックにしかない構造（移植する）**

- `ledger`。
- `rows`（プラン別・開催回別）。
- `panel`（未選択プラン）。

**クラス対応（mock → 既存）**

- `table-card` + `data` を維持し、`rows` 風の余白を当てる。

**リスク**

- 按分は実装だけの機能。**節ごと落とさない**。
- プラン別の「対象」列は実装だけ。**落とさない**。

**完了条件**

- 按分・未選択プラン・2 テーブルが残っている。

### 21 新規イベント作成（`/organizer/events/new`）

**実装の機能台帳**

- `EventForm`（5 ステップ、`event-steps`）。
- 下書き保存: `POST /api/v1/organizer/events/[id]/draft`（新規時は `/api/v1/public/events`）。
- 公開: `POST /api/v1/organizer/events/[id]/publish`、402 は `PricingModal`、403 は `register-required` / `phoneVerifyUrl`。
- `FlyerGeneratePanel`、`FlyerSelectModal`、`flyerDraftKey`。
- `QuotaStatusBanner`、`PricingModal`。
- ゲスト（未登録）の 2 件目制限と会員登録導線。
- `?draftId` での再開。

**モックに無い実装機能（保持する）**

- 下書きの自動保存・再開（`draftId`、`router.replace`）。
- チラシ生成・選択。
- 利用枠・購入モーダル。
- ゲスト制限の案内。

**モックにしかない構造（移植する）**

- `progress-card` / `progress-card__head` / `progress-card__track` / `progress-card__fill` / `progress-dots`。
- `event-step` / `event-step__heading` / `event-step__toggle` / `event-step__number` / `event-step__labels` / `event-step__summary` / `event-step__state` / `event-step__body` / `event-step__actions`。
- `repeat-block` / `repeat-row--schedule`。

**クラス対応（mock → 既存）**

- `EventForm` の既存ステップ構造 → `event-step` へ。`aria-expanded` と開閉状態は既存ロジックを維持。
- 進捗は `event-step__state`（未入力 / 入力済み）から算出する。**新しい state を足さない**。

**リスク**

- ステップの開閉は `EventForm` のロジック。**マークアップだけ**替える。
- 下書き保存のタイミング（`onChange` デバウンス）を変えない。
- 進捗の「必須 3 / 全 5」は実装の必須判定と一致させる。**独自の数え方をしない**。

**完了条件**

- 5 ステップの開閉・下書き・公開・402/403・チラシが動く。

### 22 イベントの編集（`/organizer/events/[id]/edit`）

**実装の機能台帳**

- `GET /api/v1/organizer/events/[id]`（`role`、`stats`、`pricingModeLocked`）。
- `useEditLock`（排他ロック、`LockConflictModal`、強制取得）。
- `EventForm`（`showStatus`、`pricingModeLocked`）。
- `CoHostPanel`（`role === "OWNER"` のときだけ）。
- `FlyerGeneratePanel`、`FlyerSelectModal`。
- 保存: `PATCH`（402 は `PricingModal`）。
- `QuotaStatusBanner`（下書きのときだけ）。

**モックに無い実装機能（保持する）**

- 排他ロックの取得・競合・強制取得。
- `pricingModeLocked`（出席者がいると費用体系を変えられない）。
- チラシの再生成・選択。

**モックにしかない構造（移植する）**

- `notice`（編集中の残り時間）。
- `panel` + `rows`（共同幹事）。
- `event-step`（折りたたみ）。
- `page--form`。

**クラス対応（mock → 既存）**

- `CoHostPanel` の内部を `rows` へ。
- `EventForm` → `event-step`。

**リスク**

- ロックの残り時間は `useEditLock` が持つ。**独自のカウントダウンを足さない**。
- `role` の判定を変えない。共同幹事に解除ボタンを出さない。

**完了条件**

- ロック・競合・強制取得・保存・402・共同幹事が動く。

### 23 下書き一覧（`/organizer/events/drafts`）

**実装の機能台帳**

- `/api/v1/organizer/events` から `status === "DRAFT"` を抽出。
- `OrganizerTabs`。
- `EventLifecycleModal`（削除のみ）、`Toast`。
- プレビュー / 編集 / 削除。
- 空状態。

**モックに無い実装機能（保持する）**

- 削除の確認モーダル。
- `role`（主催 / 共同主催）の表示。
- 空状態の案内。

**モックにしかない構造（移植する）**

- `org-subnav`。
- `draft-card` / `draft-card__title` / `draft-card__meta` / `draft-card__actions`。

**クラス対応（mock → 既存）**

- `card` → `draft-card`。
- 削除ボタンは既存の `setDeletingId` を呼ぶ。

**リスク**

- モックは削除を即時実行に見せるが、実装は確認モーダル。**確認を残す**。

**完了条件**

- プレビュー・編集・削除（確認つき）が残っている。

### 24 下書きのプレビュー（`/organizer/events/[id]/preview`）

**実装の機能台帳**

- `PreviewClient`: `GET /api/v1/organizer/events/[id]`。
- 公開: `POST .../publish`（402 → `PricingModal`、403 `PHONE_REQUIRED` → `phoneVerifyUrl`、403 `REGISTER_REQUIRED` → `register-required`、409 → 既公開）。
- `PosterHero`、`EventMetaCard`（出欠フォームなし）。
- `QuotaStatusBanner`、`VerifyPaymentBanner`、`PricingModal`、`Toast`。
- `canPublish`（`isDraft && registered && role === "OWNER"`）。

**モックに無い実装機能（保持する）**

- 409 / 403 の分岐。
- 利用枠バナーと決済確認。
- 公開済みのときの告知ページ導線。

**モックにしかない構造（移植する）**

- `notice`（下書きの説明）。
- `panel` + `panel__actions`（公開 / 編集 / 下書き一覧）。
- `empty`（出欠フォームは出ません）。

**クラス対応（mock → 既存）**

- `PosterHero` / `EventMetaCard` のクラスを維持。
- `panel__actions` に公開ボタンを置く。

**リスク**

- 公開ボタンの条件（`canPublish`）を緩めない。
- 公開後の `router.replace(/events/[id])` を変えない。

**完了条件**

- 402 / 403 / 409 の分岐が残っている。

### 25 参加者名簿（`/organizer/events/[id]/participants`）

**実装の機能台帳**

- `GET /api/v1/organizer/events/[id]/participants`（`REGISTER_REQUIRED` は案内へ）。
- `RevenueSummaryLedger`。
- 未選択プランの警告。
- ヘッダー操作: リマインド送信（`POST .../reminders`）、文面コピー（`GET .../reminders`）、参加者ページ、共有リンク、売上、編集。
- `ParticipantListTable`: 出欠の絞り込み、名前検索、CSV、行内編集（`PATCH`）、削除（`DELETE`）、領収書（`ReceiptIssueModal` → `receipts/[participantId]`）。
- `Toast`。

**モックに無い実装機能（保持する）**

- 行内編集と削除。
- CSV 出力。
- リマインドの送信結果（`sent` / `recorded` / `skippedGuests`）。
- 文面コピー。
- 費用プランの割り当て。
- 領収書の発行モーダル。

**モックにしかない構造（移植する）**

- `roster-summary`（回答 / 参加 / 未定 / 欠席 / 集金済み）。
- `table-card` / `table-card__head` / `table-card__title` / `table-card__search` / `table-card__scroll` / `table-card__foot`。
- `roster` テーブル（`roster__name`、`roster__meta`、`is-num`）。
- `step-list`（名簿のあとの作業）。

**クラス対応（mock → 既存）**

- `data` テーブル → `roster`。列は実装の 7〜8 列を維持（モックは 7 列）。
- `roster-toolbar` の `segment` は既存の `radio` / `button` を維持。
- `roster-summary` は `RevenueSummaryLedger` と並置せず、**統計は 1 か所**にまとめる。

**リスク**

- 名簿は `ParticipantListTable` が編集状態を持つ。**テーブルごと書き換えない**。クラスと `caption` / `scope` を当てる。
- モックの「印刷」は実装に無い。**新規に足さない**（領収書の印刷は 26）。
- `roster-summary` と `RevenueSummaryLedger` が二重にならないよう、集金額はどちらか一方に置く。

**完了条件**

- 絞り込み・検索・CSV・行内編集・削除・領収書・リマインドがすべて動く。

### 26 幹事向け領収書（`/organizer/events/[id]/receipts/[participantId]`）

**実装の機能台帳**

- `GET .../receipt`（`REGISTER_REQUIRED` は案内へ）。
- `ReceiptSheet`（印刷）。
- 再発行: `POST .../receipt`（`ReceiptIssueModal`）。
- 名簿へ戻る。

**モックに無い実装機能（保持する）**

- 再発行モーダル（宛名・金額・但し書きの入力）。
- `REGISTER_REQUIRED` の分岐。
- 発行エラーの表示。

**モックにしかない構造（移植する）**

- `receipt-sheet` 一式。
- `kv`（参加者・費用プラン・支払い・発行履歴）。
- `notice`（会員の幹事だけ）。

**クラス対応（mock → 既存）**

- `receipt` → `receipt-sheet`（05 と同じ）。
- `no-print` を維持。

**リスク**

- 再発行で番号が変わらないこと（実装の仕様）。**モックの注記をそのまま活かす**。
- 印刷時に操作ボタンを出さない（`no-print`）。

**完了条件**

- 再発行・印刷・名簿へ戻るが動く。印刷で領収書だけが出る。

### 27 公開直後の案内（`/organizer/register-required`）

**実装の機能台帳**

- `eventId` クエリ（不正 ID は「見つかりません」）。
- `GET /api/v1/organizer/events/[id]`（`registered` を見る）→ `guest` / `registered`。
- 失敗時は `/api/v1/public/events/[id]` → `forbidden` / `not-found`。
- `registered` は `/organizer/events` へ `router.replace`。
- 共有 URL のコピー（失敗時は手動コピー用 input に切替）。
- 会員登録 / ログイン（`next=/organizer/events?registered=1`）。

**モックに無い実装機能（保持する）**

- 4 状態（loading / guest / registered / forbidden / not-found）。
- クリップボード失敗時の手動コピー欄。
- `registered` の自動リダイレクト。

**モックにしかない構造（移植する）**

- `panel` + `field`（共有 URL）。
- `rows`（登録後にできること 4 件）。
- `alert alert--success`。

**クラス対応（mock → 既存）**

- `card card--padded` → `panel`。
- `quote` → `input`（readonly）。

**リスク**

- 4 状態の分岐を減らさない。モックは成功状態しか持たない。
- 第三者に案内を出さない（`forbidden`）。**この制約を落とさない**。

**完了条件**

- 4 状態が出る。コピー失敗時に手動コピーへ切り替わる。

### 28 公開プロフィールの編集（`/organizer/profile`）

**実装の機能台帳**

- `OrganizerProfileForm`（`GET` / `PUT /api/v1/organizer/profile`）。
- 公開可否（`isPublished`）、肩書き、自己紹介（文字数）、活動エリア、タグ（最大 3）、リンク（X / Instagram / Web / LINE）、実績の表示。
- プレビュー（`OrganizerProfileView preview`）。
- `OrganizerTabs`。

**モックに無い実装機能（保持する）**

- 保存のバリデーション（文字数・URL 形式）。
- プレビューの非公開警告。
- 保存後のトースト。

**モックにしかない構造（移植する）**

- `org-subnav`。
- `panel`（公開の設定 / 実績の表示）。
- `segment`（公開する / しない）。
- `genre-chips` / `chip`（タグ選択）。
- `field` + `help`（文字数カウンタ）。

**クラス対応（mock → 既存）**

- 既存フォームの `field` を維持し、`chip` をタグ選択に当てる。
- `segment` は既存の `radio` / `button` を維持。

**リスク**

- タグ上限 3 は実装の制約。**UI だけでなく保存側も変えない**。
- プレビューは同一ページ内のモーダル。**別ルートにしない**。

**完了条件**

- 公開可否・4 リンク・タグ 3 件上限・文字数・プレビューが動く。

### 29 主催者マイページ（`/mypage`）

**実装の機能台帳**

- `/api/v1/user/profile`（401 は主催者ログイン）。
- `/api/v1/organizer/events`（`DRAFT` を除外して直近 3 件）。
- `/api/v1/organizer/profile`（`isOrganizer` のときだけ）。
- `QuotaStatusBanner`、`VerifyPaymentBanner`、`StripePortalButton`、`PricingModal`。
- 主催イベント 3 件（編集画面へ）、残り件数の導線。
- プロフィールの状態と編集 / 公開ページ。
- ログアウト。

**モックに無い実装機能（保持する）**

- 利用枠バナー、未払い確認、Stripe ポータル、購入モーダル。
- 公開プロフィールの有無による出し分け。
- 残り件数の導線。

**モックにしかない構造（移植する）**

- `org-subnav`。
- `roster-summary`（公開中 / 回答待ち / 見込み売上 / 無料の残り / プラン）。
- `rows`（直近の催し）。
- `panel`（利用枠と契約 / 公開プロフィール / アカウント）。

**クラス対応（mock → 既存）**

- `card`（催し）→ `rows__item`。
- `stat-grid` → `roster-summary`。

**リスク**

- 回答待ち・見込み売上は実装の `event.stats` から足す必要がある。**API に無い数値をでっち上げない**。無い項目は出さない。
- `DRAFT` を混ぜない（実装は `filter` 済み）。

**完了条件**

- 利用枠・プロフィール・直近 3 件・ログアウトが残っている。

## 検証記録（2026-10-24）

29 画面を実データで撮り、モックと 1 画面ずつ突き合わせた記録です。
再現手順と、見つけた差分の処置を残します。

### 手順

```powershell
npm run db:seed:ui   # 催し・参加者・領収書・確認用トークンを入れる
npm run ui:shots     # 390 / 1280 を撮り、docs/ui-review/screens/ と report.json を更新する
npm run ui:map       # 29 画面が 1 回ずつ・パスが実在することを確かめる
```

`ui:shots` は 1 枚ごとに次を記録します。`report.json` の `screens[]` がそのまま証拠になります。

- 横スクロール（`scrollWidth - innerWidth`）
- 読み込みに失敗した画像（`naturalWidth === 0`）
- コンソールのエラーと 400 以上のレスポンス

### 結果

| 項目 | 値 |
| :--- | :--- |
| 撮影枚数 | 122（実装 66・モック 56） |
| 横スクロール | 0 枚 |
| 画像の読み込み失敗 | 0 枚 |
| コンソールエラー | 0 枚 |
| HTTP 400 以上 | 0 枚 |

実装の 66 枚は、同じ画面でも状態が違うもの（告知ページの通常・満員・締切後・会員、参加履歴の空、領収書の有無など）を含みます。
モックは 29 画面 × 2 幅の 56 枚です（一部のモックは 1280 のみ）。

証拠画像: `docs/ui-review/screens/*.png`、モックは `docs/ui-review/screens/mock/*.png`。

### この周回で直したもの

| 症状 | 原因 | 直した場所 |
| :--- | :--- | :--- |
| モックにある暖色・影・角が実装で出ない | `src/app/deco.css` の先頭に UTF-8 BOM があり、`:root` が `・ｿ :root` という不正なセレクタとして捨てられていた | `src/app/deco.css` |
| 空状態の見出しと本文が 1 行につながる | `.empty__title` / `.empty__body` を `span` で置く画面があり、`display` が `inline` のままだった | `src/app/deco.css` |
| 空状態の字がモックより大きい | 見出し `1rem`・本文 `0.875rem` だった | `src/app/deco.css`（`0.9375rem` / `0.8125rem`） |
| 名簿の「出席」が 2 行に割れる | 狭いセルで `.badge` が折り返していた | `src/app/attendance.css` の `.badge` に `white-space: nowrap` |
| チラシの無いカードで本文が 4.5rem 幅に潰れる | 3 列固定のため、`img` が無いと本文が 1 列目（サムネイル列）に入っていた | `.event-card--no-thumb`（`src/app/deco.css`、`EventCard`、参加者ホーム） |
| 主催一覧のカードで操作 4 つが本文を押し潰す | 右の `auto` 列が max-content を取り、本文の列が 0px になっていた | `.event-card > .event-card__actions` を本文の下へ（`src/app/deco.css`） |
| 端末のダーク設定で配色が自動反転する | `color-scheme` が未指定だった | `:root { color-scheme: light }`（`attendance.css`） |
| 幅 390 と 1280 で確認画面の 2 枚目が 400 になる | メール変更トークンが 1 本で、1 枚目の撮影が使用済みにしていた | 幅ごとに 1 本ずつ発行（`seed-ui-demo.mjs`、`ui-shots.mjs`） |

### 意図して残した差分

モックに寄せると機能か正確さが落ちるため、見た目を合わせなかった箇所です。
各画面の節の「モックに無い実装機能（保持する）」が理由の正です。

| 画面 | 残した差分 | 理由 |
| :--- | :--- | :--- |
| 03 利用規約 | 実装の方が長い（条文数が多い） | 条文の正は実装。モックは見本 |
| 06 主催者のプロフィール | 「これからの催し」の行が無い | 催し一覧 API を新たに呼ばない |
| 08 / 10 認証 | カードが 1 枚（モックは電話・確認番号の 2 枚） | `PhoneScreen` は同一ページの別ステップ。分割すると状態が壊れる |
| 14 参加者ホーム | 行の高さが高い（出欠変更・領収書・主催者の導線を持つ） | 導線を落とすと機能が消える |
| 17 主催一覧 | カードの操作が本文の下（モックは右の 1 列） | 操作が 4 つあり、右列に積むと本文が読めない |
| 22 イベントの編集 | 全ステップを開いたまま | 折りたたむと保存漏れが起きやすい。編集は全体を見せる |
| 25 参加者名簿 | 行数が多い | 投入データの参加者数。表の列・絞り込みは一致 |
| 29 主催者マイページ | 「利用枠と契約」のパネルが無い | 利用枠は `QuotaStatusBanner` が持つ。二重に置かない |

---

## 画面追加・変更時の手順

1. `style-guide/mock-*.html` と `style-guide/mock-screens-data.js` を更新する。
2. この表の行と節を同じ PR で更新する。
3. `npm run ui:map` を通す（29 件が 1 回ずつ、パスが実在、状態が規定内）。
4. `npm run check` を通す。
5. 390px / 1280px のスクリーンショットを PR に添える。
