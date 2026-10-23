# イベントの下書き保存・プレビュー公開・下書き一覧

> 作成画面で入力を失わないよう、公開前に下書きとして保存し、告知ページと同じ見た目で確認してから公開できるようにする issue。GitHub: [#50](https://github.com/HirofumiSato/EventKreater/issues/50)

## 背景

作成画面（SCR-ORG-02）の最終ステップの主操作は「公開する」だけで、途中でやめると入力が失われた。公開前に告知ページを確認する手段も無かった。`GET /api/v1/public/events/[id]` と `/events/[id]` は `PUBLISHED` / `CLOSED` だけを返し、`DRAFT` は 404 になるためである。

`EventStatus.DRAFT` 自体は既にあったが、枠切れ時の退避（[draft-checkout-and-publish.md](draft-checkout-and-publish.md)）専用で、作成画面からの明示的な保存・プレビュー・下書き一覧・下書きの単独削除は無かった。

## 決定

| 論点 | 決定 |
| :---- | :---- |
| 保存できる人 | 会員のみ。未登録の幹事には「下書き保存」を出さず、従来どおり即公開だけを出す（API は 403 `REGISTER_REQUIRED`） |
| 下書きの必須項目 | 催し名・開催日時1件以上・費用プラン1件以上・場所。定員・申し込み期限・チラシは空でよい |
| 枠 | 下書きでは消費しない。公開時に1回だけ消費する。複製由来の下書きは二重に引かない（`quota_charged_at`） |
| プレビュー | `/organizer/events/[id]/preview` を新設。幹事認証・`noindex`。告知ページと同じ部品を使い、出欠フォームは出さない |
| 下書き一覧 | `/organizer/events/drafts` を新設。主催一覧（SCR-ORG-01）とマイページの要約からは `DRAFT` を外す |
| 作成画面 | 最終ステップに「下書き保存」と「プレビューを見る」の2ボタン |
| 編集画面 | 直接公開も残す。`StatusSection` の選択は変えない。「プレビュー」リンクを足す |
| 2回目以降の保存 | ロック不要の `POST /api/v1/organizer/events/[id]/draft`。編集画面の `PUT` は排他ロック必須のまま |
| 削除 | 下書きは確認のみで論理削除。受付停止（`CLOSED`）は出さず、API も 409 `DRAFT_CANNOT_STOP` で断る |
| 公開の権限 | 筆頭幹事（`OWNER`）の会員のみ。共同主催者はプレビューを見られるが公開はできない |
| 一覧 API | 既定は全件のまま。絞り込みは画面側で行う（マイページとカレンダーが全件前提のため） |

## フロー

```text
[新規作成（会員）]
入力 →「下書き保存」→ POST /api/v1/public/events {status: DRAFT} → draftId
     → URL を ?draftId= に置き換え
     →「プレビューを見る」→ POST .../draft（2回目以降）→ /organizer/events/<id>/preview
     →「公開する」→ POST .../publish（枠を1回消費）→ /events/<id>

[枠が無い]
プレビューで「公開する」→ 402 → PricingModal（returnTo=プレビュー）
  → 購入 → /organizer/events/<id>/preview?session_id=...&draftId=...
  →「公開する」を再試行

[下書き一覧]
/organizer/events/drafts → プレビュー / 編集 / 削除
```

## 実装

| ファイル | 役割 |
| :---- | :---- |
| `src/modules/events/lib/events.ts` | `saveEventDraft`（行ロック → 状態確認 → `syncEventOptions` → 更新 → チラシ回数の付け替え） |
| `src/modules/events/lib/draft.ts` | `assertDraftSaveStatus`。保存入口で状態変更を受け付けない |
| `src/modules/events/lib/lifecycle.ts` | `assertCanStopEvent`。下書きの受付停止を 409 で断る |
| `src/modules/events/lib/steps.ts` | `firstIncompleteDraftStep` / `isDraftReady`。下書きに要る3ステップを明示 |
| `src/lib/schemas.ts` | `SaveEventDraftSchema`（`UpdateEventSchema` + `flyerDraftKey`） |
| `src/app/api/v1/organizer/events/[id]/draft/route.ts` | 下書きの上書き保存。オーナー会員のみ |
| `src/app/api/v1/organizer/events/[id]/lifecycle/route.ts` | `close` の前に `assertCanStopEvent` |
| `src/modules/billing/lib/checkout-return.ts` | 戻り先に `/organizer/events/<uuid>/preview` を追加 |
| `src/modules/events/components/EventStepForm.tsx` | 最終ステップの2ボタン。保存とプレビューで同じ検証を通す |
| `src/app/organizer/events/new/page.tsx` | `saveDraft`。1回目は作成、2回目以降は専用 API。URL に `draftId` を残す |
| `src/app/organizer/events/[id]/preview/page.tsx` / `PreviewClient.tsx` | プレビューと公開。`noindex` |
| `src/app/organizer/events/drafts/page.tsx` | 下書き一覧と削除 |
| `src/app/organizer/events/page.tsx` / `src/app/mypage/page.tsx` | `DRAFT` を表示から外す |
| `src/modules/organizers/components/EventLifecycleModal.tsx` | 下書きでは停止を出さず、削除だけにする |
| `src/lib/serializers.ts` | `serializeOrganizerSummary` に `userId` を足し、プレビューから公開プロフィールへリンクする |

## テスト

- `tests/unit/draft-save.test.ts`: 下書きの入力条件（`SaveEventDraftSchema`）、保存入口の状態制限、保存できるステップ
- `tests/unit/draft-lifecycle.test.ts`: 下書きの受付停止が 409
- `tests/unit/checkout-intent.test.ts`: プレビューの戻り先を許可し、類似パスを拒否する
- `tests/integration/draft-save-preview-publish.test.ts`（`TEST_DATABASE_URL` があるときだけ）: 下書き作成で枠を消費しない、保存で状態が変わらない、公開で1回だけ消費する、枠切れは 402、公開済みの保存は 409、存在しない ID は 404

## 受け入れ条件

- [x] 会員が「下書き保存」で `DRAFT` を作れ、催し名・日時・費用プラン・場所だけで保存できる
- [x] 「プレビューを見る」で `/organizer/events/[id]/preview` が開き、告知ページと同じ見た目で確認できる（出欠フォームは無い）
- [x] プレビューの「公開する」で `PUBLISHED` になり、枠を1回だけ消費する
- [x] 枠が無いときは 402 → 購入 → プレビューへ戻り、そのまま公開できる
- [x] 二重公開は 409
- [x] `/organizer/events/drafts` に自分の下書きだけが出て、プレビュー・編集・削除ができる
- [x] 主催一覧とマイページの要約に下書きが出ない
- [x] カレンダーの下書きはこれまで通り編集画面へ行く
- [x] 未登録の幹事は下書きを保存できず、会員登録の導線が出る
- [x] 公開ページ `/events/[id]` は下書きのまま 404
- [x] `npm run check` が通る

## スコープ外

- 未登録の幹事の下書き（ゲスト Cookie での保持）
- 入力途中の自動保存（localStorage）
- 放置された下書きの自動削除・期限切れ通知
- 共同主催者による下書きの公開
- プレビューからの出欠送信・共有 URL の発行
- 下書きの複製（複製は従来どおり枠を消費して下書きを作る）
