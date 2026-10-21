# 主催者に売上管理ダッシュボードを追加し、ホームで紹介する

> GitHub Issue の下書き。`gh` 未導入の環境のため、このファイルを本文として起票する。
> タイトル案: 主催者に売上管理ダッシュボードを追加する（費用プラン×参加人数から自動集計）

## 背景

主催者画面は参加・不参加の件数までしか可視化しておらず、売上がいくらになるのか分からない。

- 一覧: `src/app/organizer/events/page.tsx`（`stats.attendingCount` / `declinedCount` のみ）
- 名簿: `src/app/organizer/events/[id]/participants/page.tsx`
- 集計 API: `src/app/api/v1/organizer/events/[id]/participants/route.ts` の `summarizeStatuses`
- データ: `EventPricePlan.amount`、`Participant.status` / `pricePlanId`、`Receipt.amount`

参加者は出欠時に対象プランを選ぶため、売上は「プラン × 人数」で機械的に算出できる。
ただし現状は金額の履歴を保持しておらず、プラン金額を編集すると過去の参加者の金額も変わってしまう。

あわせて、この機能をホーム（`/`）で紹介する。現状のホームは「チラシと告知ページ」「参加者は名前と出欠だけ」「集計とリマインド」の3点しか訴求しておらず、集金面の価値が伝わっていない。

## ゴール

1. 主催イベント横断の売上ダッシュボードを追加する
2. イベント単体でもプラン別・開催回別の内訳を見られるようにする
3. プラン未選択・領収書未発行など「売上に数えられていない人」を可視化する
4. プラン金額の編集で過去の売上数字が変わらないようにする
5. ホームで売上管理の価値を伝え、初見の幹事が「自分のためのサービスだ」と理解できるようにする

## スコープ外

- 参加費のオンライン決済（`Receipt` は領収書の発行のみで、入金・決済の記録は持たない）
- プラットフォーム側の課金・クォータ（`src/modules/billing/*`、Stripe）の変更
- 返金・キャンセル待ち・定員超過の扱い
- CSV エクスポート（別 issue とする）
- ホームの料金訴求（料金比較は `/service` に任せる既存方針を維持する）

## 決定事項

| 項目 | 決定 |
| :---- | :---- |
| 主指標 | 見込み売上（プラン金額 × ATTENDING 人数）。領収書発行額は副指標として並記 |
| 金額の履歴 | `Participant` に選択時点の金額スナップショットを保持する |
| 期間の基準 | 開催日（`Event.sortDate`） |
| 初期表示期間 | 全期間（削除済み以外すべて） |
| 対象イベント | `isDeleted = false` のすべて（`DRAFT` は参加者が付かないため自然に 0 件） |
| 未登録ゲスト幹事 | 閲覧不可。名簿と同じ 403 `REGISTER_REQUIRED` |
| 導線 | ヘッダーは変えない。主催一覧のパネルにボタン、主催者画面内にサブタブ（主催一覧 / 売上） |
| 一覧カードの売上バッジ | 出さない。ダッシュボードへ集約する |
| ホームでの紹介方法 | 既存の `feature-list`（`capabilities`）に4行目として追加し、見出しを「4つ」に更新する |
| ホームのビジュアル | 画像は置かない。文章のみで開始する |
| ホームのCTA | 増やさない。主操作は「無料でイベントを作る」のまま1つに絞る |
| 平均単価 | `Math.round`（四捨五入）。0 除算は 0 |

## 集計定義

| 指標 | 定義 |
| :---- | :---- |
| 見込み売上 `expectedRevenue` | `status = ATTENDING` かつ金額スナップショットあり の `Σ priceAmount` |
| 領収書発行額 `issuedRevenue` | イベントの `Receipt.amount` の合計 |
| 差額 `unreconciled` | `expectedRevenue − issuedRevenue`。「未回収」ではなく**要確認の差額**として表示する |
| 平均単価 `averagePerAttendee` | `expectedRevenue ÷ 金額スナップショットありの ATTENDING 人数`（0 除算は 0、`Math.round`） |
| プラン未選択 `unassignedPlanCount` | `status = ATTENDING` かつ `priceAmount IS NULL` の人数。売上には加算しない |
| 不参加 | `DECLINED` は売上に含めない。「不参加だがプラン選択済み」は仕様上存在しない |

- 金額は円・整数、丸めなし。表示は `toLocaleString("ja-JP")`
- 無料プラン（`amount = 0`）は小計 0 円・件数のみ計上
- 領収書は参加者が後から `DECLINED` になっても残るため、`issuedRevenue` と現在の参加者数は一致しないことがある。差額の注記に明記する

## 現行実装の制約（根拠）

1. 参加者は `pricePlanId` しか持たず、金額は `EventPricePlan.amount` の現在値のみ
   - 金額の編集は `assertPricingEditable` が許す（`src/modules/events/lib/pricing-mode.ts`）ため、過去の見込み売上が遡って変わる
   - プラン名の変更も同様
   - 出席者が選んでいるプランの削除・対象変更は 409 `PRICING_LOCKED` で止めている（削除経路は塞がっている）
2. `resolveAttendanceChoice` は `ATTENDING` 以外で `scheduleId` / `pricePlanId` を `null` にする
3. 領収書は `ATTENDING` のときのみ発行可能だが、発行後のステータス変更で削除されない
4. 出欠受付は `PUBLISHED` のみ（`isRsvpAccepting`）。`CLOSED` は過去イベントとして集計対象に必要
5. ヘッダーの主催者ナビは `docs/front_implementation_spec.md` の FE-PUB-03 で固定されているため、導線は本文側に置く
6. ホームは公開ページで、サーバーコンポーネント（`src/app/page.tsx`）。実データを持たない

## 実装方針

### 1. DB: 金額スナップショットの追加

`prisma/schema.prisma` の `Participant` に追加する。

```text
model Participant {
  // ...
  /// 出欠確定時点の費用プラン金額。null はプラン未選択、0 は無料プラン。
  priceAmount   Int?           @map("price_amount") @db.Integer
  /// 出欠確定時点のプラン名。プラン名が変わっても内訳を保つ。
  pricePlanName String?        @map("price_plan_name") @db.VarChar(50)
  /// 男女別の内訳を保つため。
  priceAudience PriceAudience? @map("price_audience")
}
```

バックフィルは `price_plan_id` から現在値を写す。`NULL` の行は復元不能のため `NULL` のまま（プラン未選択扱い）。

### 2. 書き込み箇所の更新

- `resolveAttendanceChoice`（`src/modules/events/lib/events.ts`）で `amount` / `name` / `audience` も返す
- `src/app/api/v1/public/events/[id]/rsvp/route.ts` の create / update でスナップショットを保存
- `src/app/api/v1/organizer/events/[id]/participants/[participantId]/route.ts` の PATCH で保存
- `src/app/api/v1/user/hydrate/route.ts` は `userId` の付け替えのみなので変更不要
- 複製（`.../clone`）は参加者をコピーしないため変更不要

### 3. 集計ロジック

`src/modules/revenue/lib/revenue.ts` に純粋関数を置き、API から使う。

- `summarizeRevenue(participants, receipts)` → `RevenueSummary`
- `groupByPlan(participants)` → `[{ name, audience, amount, attendingCount, subtotal }]`
- `groupBySchedule(participants, schedules)` → `[{ scheduleId, label, attendingCount, subtotal }]`

### 4. API

- `GET /api/v1/organizer/events/[id]/revenue` — 認可 `assertRegisteredOrganizer`
- `GET /api/v1/organizer/revenue` — 認可は会員であること（未登録幹事は 403 `REGISTER_REQUIRED`）
  - クエリ: `from` / `to`（`Event.sortDate`、両端含む）

### 5. UI（主催者画面）

- `/organizer/revenue`（新規）: 上部の帳票風サマリ（見込み / 発行済 / 差額 / 平均単価）、期間フィルタ、イベント別テーブル
- サマリはカードを並べず、`RevenueSummaryLedger`（`src/modules/revenue/components/`）で罫線の行にする。ラベル左・金額右で桁を揃え、狭い幅でも折り返さない
- 注記は短い名詞句にする（`参加 4 人` / `発行 1 件` / `プラン選択済み 1 人あたり`）。差額の行は注記を持たず、式も出さない。説明は `※差額は、領収書と突き合わせるためのものです。未回収額ではありません。` の脚注に1回だけ置く
- 金額は `tabular-nums` と `white-space: nowrap`。負の数は `U+2212`（`−1,000円`）にする。0 円は「無料」と言い換えない
- `/organizer/events/[id]/participants` のヘッダに売上サマリと「プラン未選択が N 人」バナー
- `OrganizerTabs`（主催一覧 / 売上）を両画面の冒頭に置く
- ヘッダー（`Navbar.tsx`）と `SITE.nav` は変更しない

### 6. UI（ホームの機能紹介）

`src/app/page.tsx` の `capabilities` に4行目を追加し、見出しを「4つ」に更新する。
文言は機能名ではなく便益で書く（既存コメントの方針）。

| 項目 | 文言 |
| :---- | :---- |
| 見出し | 幹事の手間を、4つに減らす |
| 補足 | 告知・出欠・集計・お金を、1つのURLにまとめます。 |
| 4行目のタイトル | いくら集まるか、先に分かる |
| 4行目の本文 | 費用プランと出欠から、見込みの売上を自動で計算します。何人集まれば赤字にならないかを、集金の前に確かめられます。 |

- 会員登録後の機能であることを1文添える
- 画像・CTA は追加しない
- `/service` の「できること」にも同じ機能を追加する

### 7. ドキュメント更新

- `docs/front_implementation_spec.md`: SCR-PUB-00（ホーム）、SCR-ORG-11（売上）を追加
- `docs/overall_system_requirements_common.md`: 主催者領域に売上管理を追記

## 受け入れ条件

### 売上ダッシュボード

- [ ] 主催一覧の「売上を見る」から売上ダッシュボードへ遷移できる
- [ ] 主催一覧と売上のあいだをサブタブで行き来でき、ヘッダーの並びが変わっていない
- [ ] 全イベント合計の見込み売上が、参加者 × スナップショット金額の手計算と一致する
- [ ] プラン金額を編集しても、過去参加者の見込み売上が変わらない
- [ ] イベント別・プラン別・開催回別に件数と小計が出る
- [ ] プラン未選択の参加者が件数として表示され、名簿の該当者へ誘導できる
- [ ] 領収書発行額と差額が表示され、差額が「未回収」ではない旨が脚注で分かる
- [ ] サマリは 3 画面で同じ見た目（`RevenueSummaryLedger`）で、360px でも金額が折り返さない
- [ ] 差額の行に式や長い説明を出さず、注記は名詞句に揃っている
- [ ] 初期表示が全期間で、開催日基準の絞り込みができる
- [ ] 未登録幹事（ゲスト）は会員登録の案内へ誘導される
- [ ] 未認証 401 / 他幹事 403 / 削除済みイベント除外が既存ポリシーどおり
- [ ] 平均単価が四捨五入され、参加者 0 人でも 0 円で表示される
- [ ] 単体テスト: `DECLINED` 除外、プランなし、無料プラン、男女別、0 除算、四捨五入

### ホームの機能紹介

- [ ] ホームに売上管理の紹介が表示され、見出しの数（4つ）と実際の項目数が一致する
- [ ] 文言が機能名ではなく便益（集金前に分かる）で書かれている
- [ ] 売上管理が会員登録後の機能であることが分かる
- [ ] CTA が増えていない（主操作は「無料でイベントを作る」のまま）
- [ ] 幅 375px / 768px / 1280px で `feature-row` のグリッドが崩れない
- [ ] `/service` の「できること」にも同じ機能が並んでいる

## 参考

- `prisma/schema.prisma` — `EventPricePlan`, `Participant`, `Receipt`
- `src/modules/events/lib/events.ts` — `resolveAttendanceChoice`
- `src/modules/events/lib/pricing-mode.ts` — `assertPricingEditable`
- `src/app/organizer/events/page.tsx` / `[id]/participants/page.tsx`
- `src/app/page.tsx` / `src/app/service/page.tsx`
- `src/modules/auth/lib/guards.ts` — `assertRegisteredOrganizer`
- `docs/front_implementation_spec.md` — SCR-PUB-00, SCR-PUB-06, SCR-ORG-01, FE-PUB-03
