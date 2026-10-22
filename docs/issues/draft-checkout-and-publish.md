# 枠超過時のサーバー下書きと、下書き公開 API を追加する

> 枠（クォータ）を使い切った主催者が新規作成で 402 になったとき、入力内容を失わずに購入後へ復帰できるようにする issue。画面遷移側は [organizer-home-screen-flow.md](organizer-home-screen-flow.md)。

## 背景

新規作成画面（`/organizer/events/new`）で「作成」を押したとき、枠が無いと `402 QUOTA_EXCEEDED` が返る。現状は `PricingModal` を開くだけで、入力中のフォームは保存されない。購入後に `/organizer/events/new` へ戻っても内容は空になり、参加者はもう一度入力し直すことになる。

Checkout の `success_url` も `/organizer/events/new?session_id=...` 固定で、どの入力を復元すべきかの手がかりが無い。

加えて、複製した下書きを編集画面から公開する経路では `PUT` が 402 を返しうるが、編集画面に `PricingModal` が無いため、そのまま行き止まりになる。

## 決定

| 論点 | 決定 |
| :---- | :---- |
| 復元の方法 | サーバー側に `status = "DRAFT"` のイベントを作り、`draftId` を Checkout の `metadata` と戻り URL に載せる |
| 下書き作成時の枠 | 消費しない。`assertCanCreateEvent` を呼ばずに作る |
| 公開時の枠 | `POST /api/v1/organizer/events/[id]/publish` で、`DRAFT → PUBLISHED` と枠消費を1つのトランザクションで行う |
| 公開 API のロック | 要求しない。作成画面はロック機構を持たないため |
| 二重公開 | `DRAFT` 以外は 409。二重に枠を消費しない |
| ゲストの下書き | 不可。403 `REGISTER_REQUIRED` を返し、会員登録へ送る |
| 編集画面の 402 | `PricingModal` を出し、`returnTo=/organizer/events/[id]/edit` で戻す |
| 複製の 402 | 下書きを作らない。ORG-01 に留まり、購入後にもう一度「コピー作成」 |
| `returnTo` の許可範囲 | `/mypage`、`/organizer/events`、`/organizer/events/new`（`?ref=<uuid>` 付きを含む）、`/organizer/events/<uuid>/edit` のみ |
| `draftId` の所有確認 | Checkout 作成時に、そのイベントが本人の `DRAFT` であることを検証する。他人のものは 403 |
| 下書きの `publicUrl` | `null` を返す |
| 放置された下書き | 枠は消費しない。削除しても枠は戻らない |

## フロー

```text
[新規作成]
402
  → POST /api/v1/public/events { status: "DRAFT" } → draftId
  → PricingModal(draftId, returnTo=/organizer/events/new)
  → Stripe success_url に draftId と returnTo
  → /organizer/events/new?session_id=…&draftId=…
  → verify で復元
  → POST /api/v1/organizer/events/[draftId]/publish（ここで枠を消費）
  → 公開完了

[複製]
402 → ORG-01 に留まる → 購入 → もう一度「コピー作成」

[複製した下書きを編集画面で公開]
保存 → PUT が 402 → PricingModal(returnTo=/organizer/events/[id]/edit)
  → 購入 → 編集画面へ戻る → 保存を再試行
```

## 実装方針

### 1. 入力の検証

- `src/lib/schemas.ts`
  - `CreateEventSchema` に `status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED")` を足す。**Zod は未定義キーを捨てる**ため、ここを足さないと `status: "DRAFT"` が黙って消え、即公開される。
  - `CheckoutIntentSchema` を足す。`draftId`（UUID・任意）、`returnTo`（許可パスのみ・任意）。

### 2. イベントの作成と公開

- `src/modules/events/lib/events.ts`
  - `createEventForUser`: `DRAFT` のときは `assertCanCreateEvent` を呼ばない。
  - `createEventForGuest`: `DRAFT` は 403 `REGISTER_REQUIRED`。
  - `createdEventBody`: `DRAFT` のとき `publicUrl: null`。
  - `publishDraftEvent(userId, eventId, input)`: 筆頭幹事（`OWNER`）と `DRAFT` を確認し、`quota_charged_at` が未設定なら `consumeEventQuota` で枠を1つ消費して公開する。1トランザクションで行い、枠が無ければ 402、公開済みなら 409。入力が付いていれば公開と同時に保存する。
- `src/app/api/v1/public/events/route.ts`: `input.status` を透過する。
- `src/app/api/v1/organizer/events/[id]/publish/route.ts`（新規）: `publishDraftEvent` を呼ぶだけ。
- `src/app/api/v1/organizer/events/[id]/route.ts`: `PUT` で `DRAFT → PUBLISHED` になる場合は `publishDraftEvent` と同じ判定を通す。

### 3. Checkout

- `one-time` / `subscription` の両ルートで `draftId` / `returnTo` を受け、所有を確認し、`metadata` と `success_url` / `cancel_url` に載せる。
- `verify` の応答に `draftId` / `returnTo` を足す。

### 4. 画面

| ファイル | 変更 |
| :---- | :---- |
| `src/modules/billing/hooks/useEventQuota.ts` | `startOneTimeCheckout(intent?)` / `startSubscriptionCheckout(intent?)`。`PHONE_REQUIRED` の戻り先も `returnTo` に従う |
| `src/modules/billing/components/PricingModal.tsx` | `context` prop でキャンセル文言を切り替える（作成・一覧・マイページ・編集） |
| `src/modules/billing/components/VerifyPaymentBanner.tsx` | `returnTo` へ戻り、`draftId` を保持する |
| `src/app/organizer/events/new/page.tsx` | 402 で下書きを作成してモーダルを開く。`?draftId=` で復元し、公開は publish API |
| `src/app/organizer/events/[id]/edit/page.tsx` | 402 で `PricingModal` |
| `src/app/organizer/events/page.tsx` | `VerifyPaymentBanner` を置く（`returnTo` が一覧のときの復帰先） |

### 5. テスト

- `tests/unit/event-payload-schema.test.ts`: `status` の既定値・`DRAFT` の受理。
- `tests/unit/checkout-intent.test.ts`（新規）: `returnTo` の許可リスト、`draftId` の型。
- `tests/unit/guest-draft.test.ts`: ゲストの `DRAFT` 拒否と、下書きの応答が `publicUrl: null` になること。
- `tests/integration/draft-publish.test.ts`（新規）: 402 → 下書き → publish で1回だけ消費、二重 publish で二重消費しない、`PAST_DUE` は 402。`TEST_DATABASE_URL` があるときだけ走る。

## 受け入れ条件

- [x] 枠 0 の会員が新規作成すると、402 の前に下書きが作られ、入力内容が失われない
- [x] 購入後に `/organizer/events/new?draftId=…` へ戻り、フォームが復元される
- [x] 下書きの作成では枠を消費せず、`publish` で1回だけ消費する
- [x] 二重に publish しても枠を二重消費しない（2回目は 409）
- [x] 他人の `draftId` を指定した Checkout は 403
- [x] ゲストは下書きを作れず、403 `REGISTER_REQUIRED` で会員登録へ送られる
- [x] 下書きの `publicUrl` は `null` で、カードに公開ページのリンクが出ない
- [x] 編集画面で 402 になっても行き止まりにならず、購入後に保存をやり直せる
- [x] `returnTo` が許可リスト外なら 400
- [x] `npm run check` が通る

> 結合テスト（`tests/integration/draft-publish.test.ts`）は `TEST_DATABASE_URL` がある環境で走る。無い環境ではスキップされ、ユニットテストと `tsc` だけが検証になる。

## スコープ外

- 下書きの自動保存・期限切れ削除
- 購入前にフォーム内容をブラウザへ保存する仕組み
- 枠の返還・払い戻し
- サブスクリプションのプラン変更 UI
