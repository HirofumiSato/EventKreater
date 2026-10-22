# 共同主催の売上を、割合方式と人数方式で按分する

> GitHub Issue の下書き。`gh` 未導入の環境のため、このファイルを本文として起票する。
> タイトル案: 共同主催の売上を、割合方式と人数方式で按分する
> 前提: `docs/issues/event-owner-and-cohosts.md`（オーナーと共同主催者の分離）の後続。

## 背景

売上は現在、イベント単位の合計しか持たない。主催者が複数いても、誰がいくら受け取るかを画面でも API でも分けられない。

- 集計は `summarizeRevenue` が `priceAmount` を足すだけで、主催者への紐付けがない（`src/modules/revenue/lib/revenue.ts:43-79`）。
- `Participant` は `priceAmount` を持つが、どの主催者が集めたかの列はない（`prisma/schema.prisma` の `Participant`）。
- 横断の売上は、自分が `OWNER` のイベントと `CO_HOST` のイベントを区別せず合算する（`src/app/api/v1/organizer/revenue/route.ts:64-115`）。
- 売上の内訳は幹事なら誰でも全会額を見られる（`src/app/api/v1/organizer/events/[id]/revenue/route.ts:22`、`assertRegisteredOrganizer`）。
- 領収書の発行者は「発行した幹事」で、イベントの代表ではない（`src/app/api/v1/organizer/events/[id]/participants/[participantId]/receipt/route.ts:66-73`）。
- 共同主催者は招待で追加されるだけで、売上の分担を決める場所がない（`src/modules/organizers/lib/invitations.ts`）。

## 決定事項

| 論点 | 決定 |
| :---- | :---- |
| 割合方式 | 均等割を初期値にし、主催者ごとの割合を上書きできる。内部は basis points（1/10000）、合計 10000 を必須 |
| 人数方式 | 共同主催者ごとに人数を後から入力する。合計は出席者数を超えられない |
| 方式の選択 | イベントごとに「割合方式」「人数方式」を選ぶ |
| 按分の対象 | 見込み売上と領収書発行額の両方を、同じ配分で按分する |
| 端数 | 各人を切り捨て、余りは主催者（`OWNER`）へ寄せる |
| 人数の不一致 | 出席者数を超える保存は 409。不足分は「未割当」として残す |
| 閲覧範囲 | イベントごとに「全員に公開」「各自の分だけ」を選ぶ。既定は「各自の分だけ」。主催者は常に全員分を見る |
| 設定権限 | 主催者のみ（`assertRegisteredOwner`）。未登録は 403 `REGISTER_REQUIRED` |
| 主催者が1人 | 按分の節を出さない（全額がその1人） |
| 旧データのゲスト共同主催 | 表示は「共同主催者（未登録）」。按分の行には含めるが、本人は閲覧できない |
| 按分の履歴 | 保存しない。現在の設定から毎回計算する。金額そのものは申込時点のスナップショットで固定済み |
| 用語 | 画面は「主催者」「共同主催者」。DB と API は `OWNER` / `CO_HOST` のまま |

### 閲覧範囲の考え方

「主催者が自分の分を共同主催者へ見せる」か「共同主催者は自分の分だけ見る」かは、イベントの性質で変わる（飲み会の割り勘と、サークルの会計で扱いが違う）。固定せず、イベントごとに選べるようにする。

| 値 | 主催者の見え方 | 共同主催者の見え方 |
| :---- | :---- | :---- |
| `OWN_ONLY`（既定） | 全員分 | 自分の行だけ。他の人数と合計だけを「他の N 人分」と出す |
| `ALL` | 全員分 | 全員分 |

主催者は設定値にかかわらず全員分を見る。設定を変えられるのは主催者だけなので、自分の可視性を自分で下げる必要がない。

## 計算規則

主催者の並びは `createdAt` 昇順とする。`total` は `expectedRevenue` または `issuedRevenue`。

### 割合方式

- `shareBps` は 0〜10000 の整数。合計は 10000。
- 均等割の初期値: 主催者数を `N` とすると、主催者以外を `floor(10000 / N)`、主催者を `10000 - floor(10000 / N) * (N - 1)` にする。3人なら 33.33% / 33.33% / 33.34%。
- `share_i = floor(total * shareBps_i / 10000)`
- 余り `total - Σshare_i` は主催者へ加算する。
- 未割当は出ない。

### 人数方式

- `headcount_i` は 0 以上の整数。`H = Σheadcount_i`、`H <= attendingCount`。
- `allocatedTotal = floor(total * H / attendingCount)`
- `share_i = floor(total * headcount_i / attendingCount)`
- 余り `allocatedTotal - Σshare_i` は主催者へ加算する。
- `未割当 = total - allocatedTotal`、未割当人数 `= attendingCount - H`。
- 分母は **プラン選択済みの人数ではなく出席者数** とする。人数方式は「何人連れてきたか」で分ける考え方なので、費用プラン未選択の人も人数には数える。金額への加算は 0 円のままである。
- 出席者が 0 人なら全員 0 円、未割当も 0 円。

### 共通

- 金額は円の整数。`Math.floor` のみ使い、四捨五入はしない。
- 領収書発行額は、発行後に不参加になった人の分も含む。人数方式でも参加者単位の紐付けは行わず、合計に対して同じ配分を掛ける。この差は「按分は集金の分担を決める表示であり、入金の記録ではない」と脚注で説明する。
- 主催者の変更（共同主催者の解除）で配分は変わる。解除された人の行は Cascade で消え、残った主催者だけで再計算する。

### 計算例

見込み売上 10,000 円、出席 3 人、主催者1人＋共同主催2人とする。

| 方式 | 入力 | 配分 |
| :---- | :---- | :---- |
| 割合（均等） | 33.33 / 33.33 / 33.34 | 3,333 / 3,333 / 3,334 |
| 割合（50/30/20） | 5,000 / 3,000 / 2,000 bps | 5,000 / 3,000 / 2,000 |
| 人数（3人を3人で） | 1 / 1 / 1 | 3,333 / 3,333 / 3,334 |
| 人数（3人中2人） | 1 / 1 / 0 | 3,333 / 3,333 / 0、未割当 3,334 円（1 人） |

## データモデル

```prisma
enum RevenueSplitMode {
  RATIO
  HEADCOUNT
}

enum RevenueShareVisibility {
  ALL
  OWN_ONLY
}

/// イベントごとの按分の設定。未設定のときは RATIO / OWN_ONLY として扱う。
model EventRevenueSetting {
  eventId         String                @id @map("event_id") @db.Uuid
  mode            RevenueSplitMode      @default(RATIO)
  visibility      RevenueShareVisibility @default(OWN_ONLY)
  updatedByUserId String?               @map("updated_by_user_id") @db.Uuid
  updatedAt       DateTime              @updatedAt @map("updated_at") @db.Timestamptz

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@map("event_revenue_settings")
}

/// 主催者1人ぶんの配分。割合方式は shareBps、人数方式は headcount を使う。
model EventRevenueShare {
  organizerId String   @id @map("organizer_id") @db.Uuid
  eventId     String   @map("event_id") @db.Uuid
  shareBps    Int?     @map("share_bps") @db.Integer
  headcount   Int?     @map("headcount") @db.Integer
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz

  organizer EventOrganizer @relation(fields: [organizerId], references: [id], onDelete: Cascade)
  event     Event          @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([eventId])
  @@map("event_revenue_shares")
}
```

- 未設定のイベントは行を作らない。読み取り時に均等割を計算して返し、保存時に全行を upsert する。
- `EventOrganizer` を権限の表のまま保ち、配分は別表にする。共同主催者の解除で配分行も消える。
- 既存データのバックフィルは不要。主催者が1人なら按分を出さない。
- Prisma の relation を成立させるため、既存モデルにも逆向きのフィールドを足す。
  - `Event`: `revenueSetting EventRevenueSetting?` / `revenueShares EventRevenueShare[]`
  - `EventOrganizer`: `revenueShare EventRevenueShare?`

## 実装方針

### 1. 計算を純粋関数へ閉じる

`src/modules/revenue/lib/allocation.ts` を追加する。DB も Next.js も触らない。

- `equalSharesBps(organizerIds)` → 均等割の bps。主催者へ余りを寄せる。
- `allocateByRatio(total, rows)` → `{ rows, unallocated }`
- `allocateByHeadcount(total, rows, attendingCount)` → `{ rows, unallocated }`
- `allocateRevenue(input)` → 見込みと発行済みの両方を持つ結果。端数は主催者へ寄せる。

```
type AllocationInput = {
  mode: "RATIO" | "HEADCOUNT";
  organizers: { organizerId: string; role: "OWNER" | "CO_HOST" }[]; // createdAt 昇順
  shares: { organizerId: string; shareBps: number | null; headcount: number | null }[];
  expectedRevenue: number;
  issuedRevenue: number;
  attendingCount: number;
};
```

戻り値は主催者ごとの `expectedRevenue` / `issuedRevenue` と、全体の `unallocated`。

### 2. 読み取り

- `GET /api/v1/organizer/events/[id]/revenue` で `allocation` を返す（下記）。
- 設定が無いイベントは `configured: false` とし、均等割・`OWN_ONLY` で計算した結果を返す。
- 主催者の名前は `docs/issues/event-owner-and-cohosts.md` の `organizerDisplayName` を通す。
- 閲覧範囲の絞り込みはサーバーで行う。UI で隠すだけにしない。
- `GET /api/v1/organizer/revenue` は、イベントごとに按分を計算し、閲覧者の行だけを合算して `myShare` を返す。

### 3. 書き込み

- `PUT /api/v1/organizer/events/[id]/revenue/allocation`
  - 認可 `assertRegisteredOwner`。
  - 設定行を upsert し、配分行を upsert、主催者から外れた行を delete。1トランザクション。
  - バリデーションは下記の API 節のとおり。

### 4. API

#### `GET /api/v1/organizer/events/[id]/revenue`

`allocation` を追加する。

```json
"allocation": {
  "configured": false,
  "mode": "RATIO",
  "visibility": "OWN_ONLY",
  "canEdit": true,
  "rows": [
    {
      "organizerId": "…",
      "name": "佐藤 博文",
      "role": "OWNER",
      "isGuest": false,
      "isYou": true,
      "shareBps": 5000,
      "headcount": null,
      "expectedRevenue": 4000,
      "issuedRevenue": 3000
    }
  ],
  "unallocated": { "headcount": 0, "expectedRevenue": 0, "issuedRevenue": 0 },
  "hiddenRows": 1
}
```

- `rows` は閲覧範囲で絞る。主催者は常に全行。共同主催者は `visibility = ALL` のとき全行、`OWN_ONLY` のとき自分の行だけ。
- `hiddenRows` は絞った結果の差分。画面に「他の N 人分は非表示」と出す。
- `unallocated` は人数方式のときだけ 0 以外になる。
- メールアドレスと `userId` は返さない。

#### `PUT /api/v1/organizer/events/[id]/revenue/allocation`

- 認可: `assertRegisteredOwner`。
- ボディ:

```json
{
  "mode": "RATIO",
  "visibility": "OWN_ONLY",
  "rows": [{ "organizerId": "…", "shareBps": 5000 }]
}
```

- `mode = HEADCOUNT` のときは `rows[].headcount` を使う。
- バリデーション
  - `rows` はそのイベントの主催者全員を1回ずつ含む。過不足は 400 `ORGANIZER_SET_MISMATCH`。
  - 割合方式で合計が 10000 でない場合は 400 `SHARE_TOTAL_NOT_100`。
  - 人数方式で合計が出席者数を超える場合は 409 `HEADCOUNT_EXCEEDS_ATTENDING`。不足は許す。
  - 負数は 400。

#### エラーコード

| コード | HTTP | 意味 |
| :---- | :--- | :---- |
| `ORGANIZER_SET_MISMATCH` | 400 | 主催者の過不足、他イベントの `organizerId` |
| `SHARE_TOTAL_NOT_100` | 400 | 割合の合計が 100% でない |
| `HEADCOUNT_EXCEEDS_ATTENDING` | 409 | 人数の合計が出席者数を超える |
| `REGISTER_REQUIRED` | 403 | 未登録の主催者。登録案内へ送る |

### 5. UI

#### SCR-ORG-12（`/organizer/events/[id]/revenue`）

- サマリの下に「主催者別」の表を置く。列は、名前、立場、割合または人数、見込み、発行済み。
- 主催者には「配分を設定」ボタンを出す。押すとこの画面内のパネルを開く（モーダルは増やさない）。
  - 方式のラジオ（割合／人数）
  - 各主催者の入力欄。割合は % 表示（小数第2位まで）、人数は人。
  - 合計の表示。割合は「合計 100.00%」、人数は「12 / 18 人（未割当 6 人）」。
  - 公開範囲のラジオ（全員に公開／各自の分だけ）。主催者には常に全員分が出る旨を添える。
- 共同主催者は表を読むだけ。`OWN_ONLY` のときは自分の行と「他の N 人分は非表示」を出す。
- 人数方式で未割当があるときは、表の下に「未割当 6 人・12,000円」の行を出す。売上から消えたわけではないと1文で書く。
- 脚注に「按分は集金の分担を決めるための表示です。送金や決済は行いません。」を1回だけ置く。

#### SCR-ORG-11（`/organizer/revenue`）

- `RevenueSummaryLedger` に任意プロパティ `myShare` を足し、渡されたときだけ「あなたの取り分」行を出す。既存の4行は変えない。
- `イベント別` の表に「あなたの取り分」列を足す（見込みベース）。
- 合計行の「あなたの取り分」は、各イベントの按分を合算する。未割当は含めない。

#### SCR-ORG-06（名簿）

- 変更しない。按分は売上画面に集約する。

### 6. ドキュメント

- `docs/DBschema.md`: `event_revenue_settings`、`event_revenue_shares`、2つの enum を追記。
- `docs/backend_api_implementation_spec.md`: 按分の取得・更新 API、エラーコード、閲覧範囲の絞り込みを追記。
- `docs/front_implementation_spec.md` 第13節: 「13.7 按分」を追加し、表・パネル・文言・端数規則を書く。`13.2` の指標表に「あなたの取り分」を追加。
- `docs/overall_system_requirements_common.md`: 第4.6節の売上に、按分の目的（集金の分担であり送金ではない）と、閲覧範囲の設定を追記。
- `docs/archive/event-page/specs/event_page_data_model_and_crud.md`: 主催者別の按分設定を追記。

## スコープ外

- 実際の送金・決済・Stripe Connect
- 参加者ごとの「誰が連れてきたか」の紐付け（人数方式は手入力で代替する）
- 按分結果の確定保存（イベント終了時のスナップショット）
- 按分の変更履歴、監査ログ
- 主催者以外（参加者・管理者）への按分の表示
- 領収書の発行者を主催者に固定する変更

## 受け入れ条件

### 計算

- [ ] 割合方式の初期値が均等割になり、合計が 100.00% になる
- [ ] 3人・10,000円・均等割で 3,333 / 3,333 / 3,334 円になり、合計が 10,000 円になる
- [ ] 割合を 50 / 30 / 20 に変えると、その比率で按分される
- [ ] 人数方式で 18 人中 12 人を配分すると、未割当 6 人分が残る
- [ ] 人数方式で合計が出席者数を超える保存は 409 `HEADCOUNT_EXCEEDS_ATTENDING`
- [ ] 割合の合計が 100% でない保存は 400 `SHARE_TOTAL_NOT_100`
- [ ] 領収書発行額も同じ配分で按分され、見込みと発行済みで配分が食い違わない
- [ ] 出席者 0 人でも 0 除算せず、全員 0 円になる
- [ ] 主催者が1人のイベントでは按分の節が出ず、全額がその1人になる

### 権限と閲覧

- [ ] 配分の設定は主催者のみ。共同主催者は 403
- [ ] 未登録の主催者は 403 `REGISTER_REQUIRED` で登録案内へ送られる
- [ ] `visibility = OWN_ONLY` のとき、共同主催者の API 応答に他人の行が含まれない
- [ ] `visibility = ALL` のとき、共同主催者も全員分を見られる
- [ ] 主催者は常に全員分を見られる
- [ ] 共同主催を解除すると、その配分行が消え、残った主催者で再計算される
- [ ] 旧データのゲスト共同主催は「共同主催者（未登録）」と表示され、按分の行には含まれる

### UI

- [ ] 売上の内訳に「主催者別」が出て、名前・立場・割合または人数・金額が読める
- [ ] 設定パネルで方式と公開範囲を切り替えられ、保存後に表が更新される
- [ ] 合計（%・人数）が入力中に即時に出る
- [ ] 未割当があるとき、人数と金額が表の下に出る
- [ ] `RevenueSummaryLedger` の既存4行の見た目が変わらず、「あなたの取り分」行が加わる
- [ ] 360px でも金額が折り返さない（`tabular-nums` と `nowrap`）
- [ ] 脚注の「送金・決済は行わない」が1回だけ出る

### テスト

- [ ] `tests/unit/allocation.test.ts` を追加: 均等割の bps、端数、人数方式、未割当、0 除算、領収書
- [ ] `tests/integration/revenue.test.ts` に、設定の保存・再取得、閲覧範囲の絞り込み、403、409 を追加
- [ ] `tests/unit/revenue.test.ts` の既存 27 件がそのまま通る

## 参考

- `src/modules/revenue/lib/revenue.ts` — `summarizeRevenue`, `groupByPlan`, `groupBySchedule`
- `src/modules/revenue/components/RevenueSummaryLedger.tsx` — サマリの表示
- `src/app/api/v1/organizer/events/[id]/revenue/route.ts` — 内訳 API
- `src/app/api/v1/organizer/revenue/route.ts` — 横断の売上 API
- `src/app/organizer/events/[id]/revenue/page.tsx` — 内訳画面
- `src/app/organizer/revenue/page.tsx` — 横断の売上画面
- `src/modules/auth/lib/guards.ts` — `assertRegisteredOwner`
- `docs/front_implementation_spec.md` 第13節 — 売上ダッシュボードの現行仕様
- `docs/issues/organizer-revenue-dashboard.md` — 売上機能の元イシュー
- `docs/issues/event-owner-and-cohosts.md` — 前提となるオーナー／共同主催者の分離
