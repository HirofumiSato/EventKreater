# 価格キャンペーン要件定義書（`pricing_campaign_requirements.md`）

## イベント主催者向け 販売価格の期間制御・0円販売・無料期間の自動課金

本ドキュメントは、管理コンソールから単発チケット（定価 299 円）と2つの定額プラン（月額で8件まで公開 980 円 / 公開し放題 2,980 円）の販売価格を期間限定で制御する機能の要件と実装方針を定める。あわせて、0 円販売時の課金・通知・利用規約の扱いを定義する。

- 対象画面: SCR-ADM-05（`/console/pricing`）、SCR-PUB-10（`/terms`）
- 対象 API: `/api/v1/admin/pricing-campaigns*`、`/api/v1/public/pricing`、`/api/v1/billing/*`、`/api/v1/internal/billing/notices`
- 関連ドキュメント: [課金企画要件](billing_and_quota_planning_requirements.md)、[課金システム要件](billing_and_quota_system_requirements.md)、[DB 設計](DBschema.md)、[バックエンド API](backend_api_implementation_spec.md)、[フロントエンド](front_implementation_spec.md)

---

## 1. 決定事項（確定した方針）

| 論点 | 決定 | 補足 |
| :---- | :---- | :---- |
| 「0 円」の意味 | 販売価格を 0 円にする | 無料枠の追加付与ではない |
| 既存購入者への適用 | 新規申込のみ | 購入済み単発・加入済み定額プランの料金は遡及変更しない |
| 定額の割引期間 | 固定月数（加入時点で確定） | 加入からキャンペーン終了までを 1 か月単位で切り上げ |
| キャンペーン重複時 | 優先度で 1 つだけ適用 | 同順位は作成日時が新しい方 |
| 0 円単発の付与方法 | アプリ内付与 | Stripe を通さず `paid_credits + 1` と 0 円の取引記録を作る |
| 0 円単発の上限 | 1 人 N 回（既定 1 回） | キャンペーンごとに設定。電話番号確認が必須 |
| 0 円単発の丸め | 10 円単位の切り上げ、最低 10 円 | 100% 割引のときだけ 0 円 |
| 0 円の定額プランの請求方法 | Stripe クーポン（100% off / repeating） | カード登録を必須にし、期間終了後は自動課金 |
| 月額割引の適用開始 | 加入時から | 日割りはせず、各請求サイクル全体に適用 |
| 割引の最小期間 | 1 サイクル以上 | 端数は 1 か月に切り上げ |
| キャンペーン停止時 | 既存購入者は割引継続 | 新規申込のみ停止 |
| 終了前通知 | 3 日前と 1 日前の 2 回 | 0 円の定額プラン（および 100% 未満の割引で加入した定額プラン）が対象 |
| 管理操作の範囲 | 作成・編集・停止 | 削除はしない。監査ログを残す |

---

## 2. 価格計算

### 2.1. 丸め

```
請求額 = min(定価, max(10, ceil(定価 × (100 - 割引率) / 100 / 10) × 10))
ただし割引率 = 100 のときは 0 円
```

- 10 円未満は切り上げる（例: 980 円の 2% 引き → 970 円、2,980 円の 2% 引き → 2,930 円）。
- 割引率が 100% のときのみ 0 円。99% 引きは最低 10 円。
- 丸めた結果が定価と一致する割引（例: 299 円の 1% 引き）は登録できない。
- 単発と定額の両方が対象のキャンペーンは、対象となるすべての価格で値引きが成立する必要がある。

### 2.2. キャンペーン選択

有効なキャンペーン（`isEnabled = true`、`stoppedAt IS NULL`、`startsAt <= now < endsAt`）のうち、対象が一致するものを次の順で並べ、先頭だけを適用する。

1. `priority` の降順
2. `createdAt` の降順
3. `id` の降順（同時刻の最終的な決着）

複数割引の重ね掛けはしない。

#### 2.3. 適用期間（定額プラン）

- 加入時刻 `start` からキャンペーン終了 `endsAt` までの月数を、暦月で数えて端数を切り上げる。
- `months = min(12, max(1, ceil(months_between(start, endsAt))))`
- 割引終了日時 `discountEndsAt = start + months か月`。
- Stripe クーポンは `duration: "repeating"`, `duration_in_months: months` を使う。
- キャンペーン終了後に加入した場合は対象外（`startsAt <= now < endsAt` の判定）。

---

## 3. 0 円の単発チケット

### 3.1. 付与フロー

1. `POST /api/v1/billing/checkout/one-time` が現在の販売価格を解決する。
2. 請求額が 0 円なら Stripe セッションを作らず、アプリ内で付与する。
3. 電話番号未確認なら `403 PHONE_REQUIRED` を返す。
4. `users` 行を `FOR UPDATE` でロックし、同じキャンペーンで 0 円付与した件数を数える。
5. 上限未満なら `billing_transactions` に `amount = 0`, `listAmount = 299`, `discountAmount = 299`, `appliedPercent = 100`, `campaignId` を記録し、`paid_credits` を 1 増やす。
6. 上限到達時は `granted: false, limited: true` を返し、画面は購入不可として案内する。

### 3.2. 冪等性

- `Idempotency-Key` ヘッダーを `requestKey` として保存し、`UNIQUE` 制約で二重付与を防ぐ。
- 同時押しは `users` 行ロックと件数チェックで直列化する。

### 3.3. 画面

- 料金モーダルは 0 円のとき「無料で受け取る」と表示する。
- 受け取り後はモーダルを閉じ、利用枠を再取得して「公開する」の再実行を促す。
- 上限到達時はボタンを無効化し、単発購入または定額プランへの導線を残す。

---

## 4. 0 円の定額プラン（月額で8件まで公開 / 公開し放題）

### 4.1. Checkout

- 加入する階層の Price（`STRIPE_PRICE_ID_MONTHLY_8` / `STRIPE_PRICE_ID_UNLIMITED`）を使う（定価の Price を維持する）。
- 割引は Stripe クーポンで表現する。クーポンは `(キャンペーン, 版, 月数, 割引種別, 対象プラン)` ごとに作る。
  - 100%: `percent_off = 100`
  - 100% 未満: `amount_off = その階層の定価 - 請求額`（980 円 / 2,980 円）, `currency = "jpy"`
  - 共通: `duration = "repeating"`, `duration_in_months = months`
- `payment_method_collection: "always"` を指定し、0 円でもカードを登録させる。
- セッションの `metadata` に `plan`、`campaignId`、`appliedPercent` を残す。
- 申込時に `billing_transactions` へ `PENDING` 行を作り、`amount`（請求額）、`listAmount`（その階層の定価）、`discountAmount`、`campaignId`、`appliedPercent`、`stripeCouponId` を控える。

### 4.2. 確定と自動課金

- `checkout.session.completed` / `invoice.payment_succeeded` で加入を確定する。
- 0 円の初回請求は `payment_status = "no_payment_required"`、`amount_paid = 0` になるため、これを正常として扱う。
- 加入確定時に `user_usage_quotas` の `pricingCampaignId`、`discountPercent`、`discountEndsAt` を記録する。
- 期間終了後の更新請求は、Stripe がその階層の定価（980 円 / 2,980 円）で自動請求する。アプリ側の追加操作は不要。
- 更新請求で割引が付いていない場合は、割引の記録を消して通知対象から外す。

### 4.3. 既存の定額契約

- すでに `ACTIVE` の定額契約がある場合、二重契約を防ぐため `409 ALREADY_SUBSCRIBED` を返す。
- 階層の変更（月額で8件まで公開 ⇄ 公開し放題）は Stripe Customer Portal で行う。`customer.subscription.updated` の Price ID から `subscription_plan` を判定し直す。
- 値上げ前に 980 円の公開し放題へ加入した契約は `STRIPE_PRICE_ID_MONTHLY_980_LEGACY` のままとし、`UNLIMITED` として回数を数えない。

---

## 5. 終了前の通知（3 日前・1 日前）

### 5.1. 対象

- `user_usage_quotas.subscription_status = ACTIVE`
- `discount_ends_at > now`
- `discount_ends_at <= now + 3 日 + 12 時間`

### 5.2. 判定

| 残り時間 | 種別 | 文面の主眼 |
| :---- | :---- | :---- |
| 24 時間以内 | `FREE_PERIOD_ENDING_1D` | 「1 日後に終了」 |
| 24〜84 時間 | `FREE_PERIOD_ENDING_3D` | 「3 日後に終了」 |

- `percent = 100` のときは「無料期間」、それ未満は「割引期間」と表記する。
- 本文には終了日時、終了後の請求額（加入階層の定価: 980 円または 2,980 円）、解約導線（`/mypage`）、利用規約（`/terms`）を記載する。

### 5.3. 冪等性

- `billing_notices` の `UNIQUE(user_id, kind, period_end)` で同じ無料期間に対して 1 回だけ送る。
- 送信結果は `status`（`SENT` / `RECORDED`）として残す。`MAIL_WEBHOOK_URL` 未設定時は `RECORDED`（本文をログに残す）。

### 5.4. 実行方法

- `POST /api/v1/internal/billing/notices` を 1 日 1 回叩く。
- 認証は `x-billing-secret`（または `Authorization: Bearer`）と `BILLING_NOTICE_SECRET` の一致。
- ローカルと cron 用に `npm run billing:notices` を用意する。
- 例: `0 10 * * * cd /path/to/app && npm run billing:notices`

### 5.5. 通知しない場合

- 解約済み（`CANCELED`）になった契約は `discount_ends_at` を消し、以後の通知対象から外す。
- すでに割引が終了した契約は対象外。

---

## 6. 管理コンソール（SCR-ADM-05）

- ルート: `/console/pricing`
- 認可: `requireAdmin`（`platformRole = ADMIN` かつ電話番号確認済み）。
- 一覧項目: 名前、対象、割引、期間、状態、優先度、版、実績（成立件数・売上・割引総額）。
- 操作:
  - 作成: 名前、対象（単発／月額で8件まで公開／公開し放題／定額2階層／両方）、割引の種類（割合／無料）、割引率、開始・終了（JST）、優先度、0 円の上限回数、即時有効。
  - 編集: 価格に関わる項目を変えた場合は `version` を上げ、対象プランごとに新しい Stripe クーポンを作る。既存購入者には影響しない。
  - 停止: `isEnabled = false`, `stoppedAt = now()`。新規申込のみ停止。
- 監査: 作成・編集・停止のたびに `pricing_campaign_audits` へ操作者、前後値、日時を残す。
- プレビュー: 入力中の割引率から単発と2つの定額の販売価格を即時表示する。

---

## 7. API

| エンドポイント | メソッド | 認可 | 概要 |
| :---- | :---- | :---- | :---- |
| `/api/v1/admin/pricing-campaigns` | GET | 管理者 | キャンペーン一覧と実績 |
| `/api/v1/admin/pricing-campaigns` | POST | 管理者 | 作成 |
| `/api/v1/admin/pricing-campaigns/[id]` | GET | 管理者 | 詳細・監査・クーポン |
| `/api/v1/admin/pricing-campaigns/[id]` | PATCH | 管理者 | 編集（必要なら版を上げる） |
| `/api/v1/admin/pricing-campaigns/[id]/stop` | POST | 管理者 | 停止 |
| `/api/v1/public/pricing` | GET | 不要 | 現在の販売価格と実施中キャンペーン |
| `/api/v1/billing/quota` | GET | 会員 | 利用枠に加えて `pricing`, `freeGrantRemaining`, `discount` を返す |
| `/api/v1/billing/checkout/one-time` | POST | 会員 | 0 円なら付与、それ以外は Stripe セッション |
| `/api/v1/billing/checkout/subscription` | POST | 会員 | `plan` で階層を選び、クーポン付きの定額セッションを作る |
| `/api/v1/internal/billing/notices` | POST | 共有秘密 | 3 日前・1 日前の通知バッチ |

`402 QUOTA_EXCEEDED` の `pricingOptions` は、現在の販売価格（`price`）と定価（`listPrice`）、割引率、キャンペーン名を返す。

---

## 8. データベース

### 8.1. 追加テーブル

| テーブル | 役割 |
| :---- | :---- |
| `pricing_campaigns` | キャンペーン本体。対象、割引、期間、優先度、版、停止日時 |
| `pricing_campaign_coupons` | 版・月数・種類・対象プランごとの Stripe クーポン ID |
| `pricing_campaign_audits` | 作成・編集・停止の監査ログ |
| `billing_notices` | 終了前通知の送信記録（冪等性キーを含む） |

### 8.2. 追加カラム

`billing_transactions`:

| 列 | 型 | 意味 |
| :---- | :---- | :---- |
| `list_amount` | INT | 割引前の定価 |
| `discount_amount` | INT | 割引額 |
| `campaign_id` | UUID NULL | 適用キャンペーン |
| `applied_percent` | SMALLINT NULL | 適用割引率 |
| `stripe_coupon_id` | VARCHAR(255) NULL | 使用したクーポン |
| `request_key` | VARCHAR(255) UNIQUE NULL | 0 円付与の冪等キー |

`user_usage_quotas`:

| 列 | 型 | 意味 |
| :---- | :---- | :---- |
| `pricing_campaign_id` | UUID NULL | 適用中キャンペーン |
| `discount_ends_at` | TIMESTAMPTZ NULL | 割引（無料期間）の終了日時 |
| `discount_percent` | SMALLINT NULL | 適用割引率 |

### 8.3. マイグレーション

`prisma/migrations/20261021150000_pricing_campaigns/migration.sql`

- 既存の `billing_transactions.amount` を `list_amount` へ複写する。
- 追加カラムはすべて NULL 許容または既定値付きで、既存データを壊さない。

---

## 9. 利用規約（SCR-PUB-10）

- ルート: `/terms`。ヘッダー・フッター・料金ページ・購入モーダルからリンクする。
- 記載する内容:
  - 定価（単発 299 円、月額で8件まで公開 980 円、公開し放題 2,980 円）と無料枠 2 回。
  - 月額で8件まで公開プランは「公開中のイベント」が 8 件までであること。開催日を過ぎたもの、公開を一時停止したもの、削除したものは数えないこと。公開し放題は公開中のイベント数を数えないこと。
  - 期間限定キャンペーンの適用条件、丸め、優先度、既存購入者への非遡及。
  - 0 円単発の付与条件（電話番号確認、1 人 N 回、譲渡不可）。
  - 0 円の定額プランのカード登録、無料期間終了後の自動課金、日割りなし。
  - 終了日の 3 日前と 1 日前のメール通知。
  - 解約方法（Stripe Customer Portal）と返金の原則。
- 料金ページと購入モーダルにも、自動更新と通知について要約を表示する。

---

## 10. 運用・非機能

- Stripe のクーポンは版・月数・対象プランの組み合わせで作る。同じ組み合わせは再利用し、`Idempotency-Key` で二重作成を防ぐ。
- 停止・編集は既存のクーポンを削除しない。Stripe 側の `duration_in_months` が満了するまで購入者の割引は続く。
- 割引額が 0 円になる設定は API で拒否する（購入者に変化がなく、監査上も意味がないため）。
- 監査ログはキャンペーン削除時も `ON DELETE CASCADE` で消えるが、キャンペーン自体は削除しない運用とする。
- 0 円付与は `paid_credits` を増やすため、返金・異議申立の対象外（Stripe 取引が存在しない）。
- 通知の宛先は会員のメールアドレスとする。SMS は使わない。

---

## 11. 実装ファイル対応表

| 層 | ファイル |
| :---- | :---- |
| 価格計算 | `src/modules/billing/lib/pricing.ts` |
| キャンペーン CRUD・クーポン | `src/modules/billing/lib/campaigns.ts` |
| 通知バッチ | `src/modules/billing/lib/notices.ts` |
| 決済・Webhook | `src/modules/billing/lib/billing.ts` |
| 管理 API | `src/app/api/v1/admin/pricing-campaigns/**` |
| 公開 API | `src/app/api/v1/public/pricing/route.ts` |
| 通知 API | `src/app/api/v1/internal/billing/notices/route.ts` |
| 管理画面 | `src/app/console/pricing/page.tsx` |
| 料金表示 | `src/app/service/page.tsx`, `src/modules/billing/components/PricingModal.tsx`, `QuotaStatusBanner.tsx` |
| 利用規約 | `src/app/terms/page.tsx` |
| スキーマ | `prisma/schema.prisma` |
| マイグレーション | `prisma/migrations/20261021150000_pricing_campaigns/` |

---

## 12. テスト観点

- 丸め: 299 円 1% は登録不可、299 円 10% は 270 円、980 円 2% は 970 円、2,980 円 2% は 2,930 円、100% は 0 円。
- 選択: 優先度が高い方が勝つ。同順位は新しい方が勝つ。対象外は選ばれない。`SUBSCRIPTION` は定額2階層の両方、`BOTH` は単発と定額すべてに効く。
- 0 円単発: 電話番号未確認は 403。上限で付与されない。同じ Idempotency-Key で二重付与されない。
- 0 円の定額プラン: 階層ごとに初回 0 円で加入でき、`discountEndsAt` が設定される。期間終了後の請求がその階層の定価（980 円 / 2,980 円）で記録される。同じキャンペーンでも 8 回プランと公開し放題でクーポンは別になる。
- 通知: 3 日前と 1 日前に 1 回ずつ。同じ `periodEnd` では再送しない。解約後は送らない。
- 停止: 新規は定価、既存は割引が継続する。
- 編集: 版が上がり、既存購入者の取引の `appliedPercent` は変わらない。
