# 主催者が名簿へ参加者を手動で追加し、削除は論理削除で名簿の末尾に残す

## 背景

名簿（SCR-ORG-06）に載るのは、参加者が告知ページから送った出欠だけである。電話や口頭で受けた予約、当日の飛び込み、主催者の知り合いを後から名簿へ入れる手段が無く、幹事は集金と当日の受付を名簿だけで済ませられない。出欠の行を作れるのは参加者本人の送信だけで、幹事が代わりに送ると `userId` と `rsvpTokenHash` が本人の端末と食い違う。

削除も同じ画面から行うが、いまは行を物理削除する。誤って消すと元に戻せず、誰を消したのかも名簿に残らない。

- 名簿の取得は `GET /api/v1/organizer/events/[id]/participants` だけで、書き込みは出欠の変更（`PATCH`）と削除（`DELETE`）しかない（`src/app/api/v1/organizer/events/[id]/participants/[participantId]/route.ts`）。
- 定員の判定は `assertCapacityAllows` が持ち、承認と参加者側の申込で共有している（`src/modules/events/lib/events.ts`）。
- 出欠の行は `(event_id, user_id)` の一意制約を持つ（`prisma/schema.prisma`）。行を残したまま削除すると、同じ人がもう一度申し込んだときに一意制約へ当たる。
- 集計（参加人数・売上・待ち順・参加履歴）は `status` だけを見ており、削除の印を持っていない。

## 決定事項

| 論点 | 決定 |
| :---- | :---- |
| 追加の入口 | 名簿の見出し行に「参加者を追加」を置き、押すと 1 枚（`ParticipantSheet`）が開く。保存は `POST /api/v1/organizer/events/[id]/participants` |
| 追加の認可 | `assertRegisteredOrganizer`。未登録のゲスト幹事は 403 `REGISTER_REQUIRED`（名簿・集金と同じ扱い） |
| 受付状態 | 見ない。受付停止中（`status: CLOSED`）でも申し込み期限後でも追加できる。電話予約や当日の飛び込みを後から入れるため |
| 満員のときの出席 | 409 `CAPACITY_REACHED`。名簿の承認と同じく、幹事の明示的な追加は席を超えさせない。画面はその旨をトーストで出す |
| 満員のときの参加要望 | 追加できる。席を取らず、待ち順の末尾に入る |
| 追加した行の持ち主 | `userId` は `NULL`。端末 Cookie（`rsvp_token_<id>`）も発行しない。`rsvpTokenHash` は照合に使わない使い捨ての乱数だけを入れる |
| 通知 | 送らない。メールもアプリ内通知も作らない（幹事自身の操作で、知らせる相手がいない） |
| 削除の種類 | 幹事の「名簿から削除」は論理削除（`participants.deleted_at`）。参加者自身の取り消し（公開 API の `DELETE`）は今までどおり行を消す |
| 削除済みの見え方 | 名簿の最下部に灰色・取り消し線・札「削除済み」で残す。押すと「名簿に戻す」だけの 1 枚が開く |
| 削除で切るもの | `userId` を `NULL`、`rsvpTokenHash` を新しい乱数へ差し替える。一意制約に当たらず、同じ人がもう一度申し込むと新しい行として名簿に戻る |
| 削除済みの集計 | 参加人数・出欠の集計・売上・集金・待ち順・公開ページの件数・会員の参加履歴から外す。絞り込みの札の件数（`stats.deletedCount`）にだけ数える |
| 復元 | `POST /api/v1/organizer/events/[id]/participants/[participantId]/restore`。出席を戻すときは定員を数え直し、埋まっていれば 409 `CAPACITY_REACHED`。`userId` は戻さない |
| 二重の削除 | 削除済みの行をもう一度消しても 404 にせず、200 で同じ `deletedAt` を返す |
| 削除済みの編集 | `PATCH` と集金（`PUT .../collection`）は 404。名簿に戻してから編集する |

## スコープ外

- 追加した参加者への確認メールや招待 URL の発行
- 幹事が参加者の代わりに端末 Cookie を発行すること（同じ端末として出欠を変更できるようにしない）
- 削除済みの行の完全削除（`participants` の物理削除）と、削除の履歴（誰がいつ消したか）
- 幹事が入れた行と参加者本人の行の名寄せ（同じ人が後から申し込むと別の行として並ぶ）
- 削除済みの行を CSV に含める選択肢

## 実装方針

### 1. DB

```prisma
model Participant {
  // ...既存
  /// 名簿から外した日時。NULL は有効。
  /// 幹事が名簿から削除しても行は残し、名簿の末尾に薄く出す（元に戻せる）。
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz

  @@index([eventId, deletedAt])
}
```

`prisma/migrations/20261108200000_participant_soft_delete/migration.sql`

```sql
ALTER TABLE "participants" ADD COLUMN "deleted_at" TIMESTAMPTZ;
CREATE INDEX "participants_event_id_deleted_at_idx" ON "participants"("event_id", "deleted_at");
```

未削除の条件は 1 か所に置く（`src/modules/participants/lib/where.ts`）。

```ts
/** 名簿に残っている行。削除済みは数えない。 */
export const ACTIVE_PARTICIPANT_WHERE = { deletedAt: null } as const;
```

既存行は `deleted_at` が `NULL` のままで、バックフィルは要らない。

### 2. API

| エンドポイント | 変更 |
| :---- | :---- |
| `POST /api/v1/organizer/events/[id]/participants` | 新規。受付状態を見ずに 1 行作る。出席が満員なら 409 `CAPACITY_REACHED` |
| `GET /api/v1/organizer/events/[id]/participants` | 削除済みも返す。`active`（`createdAt` 昇順）→ `deleted`（`deletedAt` 降順）の順。各行に `deletedAt`、`stats` に `deletedCount` |
| `PATCH /api/v1/organizer/events/[id]/participants/[participantId]` | 削除済みは 404「削除済みの参加者です。名簿に戻してから編集してください。」 |
| `DELETE /api/v1/organizer/events/[id]/participants/[participantId]` | 論理削除へ変更。`deletedAt` を入れ、`userId` を `NULL`、`rsvpTokenHash` を差し替える |
| `POST /api/v1/organizer/events/[id]/participants/[participantId]/restore` | 新規。削除済みを戻す。出席は定員を数え直す |
| `PUT /api/v1/organizer/events/[id]/participants/[participantId]/collection` | 削除済みは 404 |

名簿の行の形は `src/modules/participants/lib/serialize.ts` の `serializeParticipantRow` に寄せ、GET・PATCH・追加の POST・復元で同じ JSON を返す。3 つ目の写しを作らない。

削除済みを外すクエリは、定員（`sumAttendingHeadcount`）・主催一覧と詳細・売上・按分・公開ページ・主催者のページ・チラシの一覧・待ち順・参加履歴・カレンダー・管理画面の参加者数に及ぶ。判定を各所へ書き分けず、`ACTIVE_PARTICIPANT_WHERE` を当てる。集計関数（`summarizeStatuses` / `summarizeRevenue` / `groupBySchedule`）は絞った行だけを渡すので変えない。

### 3. 画面

- 名簿の見出しに「参加者を追加」（`btn--primary`）を先頭で置く。
- 1 枚（`ParticipantSheet`）を 3 つの出し方にする。**追加**（`row === null`）は「参加者を追加」、初期値は出席・1 人・先頭の日時・性別に合う先頭のプラン。集金と削除は出さない。**編集**は今のまま。**削除済み**は入力欄を出さず、「〇〇 に名簿から削除しました。」と「名簿に戻す」「閉じる」だけを出す。
- 出席で料金プランが 1 つも無いときは保存できない（`refineAttendanceChoice` に合わせる）。名前が空でも保存できない。
- 定員が埋まっているときは「定員に達しています。参加要望で追加できます。」を 1 行出す。保存は止めない（判定はサーバーが持つ）。
- 削除済みの行は `.roster__row--deleted` を付け、文字を落として取り消し線を引き、出欠の札の代わりに「削除済み」を出す。並びは常に最後。
- CSV は削除済みを出さない（集金と当日の受付に使う一覧のため）。

## 受け入れ条件

### 追加

- [ ] 名簿の見出しに「参加者を追加」があり、押すと 1 枚が開く
- [ ] 名前・出欠・人数・日時・料金プランを入れて保存すると、名簿の末尾に増える（201）
- [ ] 出席で定員が埋まっていると 409 `CAPACITY_REACHED` になり、行は増えない。画面に理由が出る
- [ ] 参加要望は満員でも追加でき、待ち順の末尾に入る
- [ ] 受付停止中（`CLOSED`）でも申し込み期限後でも追加できる
- [ ] 追加した参加者にメールもアプリ内通知も送らない
- [ ] 追加した行は `userId` が `NULL` で、端末 Cookie を発行しない
- [ ] 名前が空、または出席で料金プランが無いときは保存できない
- [ ] 未登録のゲスト幹事は 403 `REGISTER_REQUIRED`

### 論理削除と復元

- [ ] 名簿から削除しても行は消えず、`deleted_at` が入る
- [ ] 削除した行は名簿の最下部に灰色・取り消し線・札「削除済み」で残る
- [ ] 削除済みの行を押すと「名簿に戻す」だけの 1 枚が開き、戻すと名簿へ戻る
- [ ] 削除済みは参加人数・出欠の集計・売上・集金・待ち順・公開ページの件数・参加履歴に入らない
- [ ] 削除した行の `user_id` は `NULL` になり、`rsvp_token_hash` は新しい乱数へ変わる（同じ人がもう一度申し込むと新しい行になる）
- [ ] 削除済みの行の `PATCH` と集金は 404
- [ ] 出席の行を戻すときに定員が埋まっていれば 409 `CAPACITY_REACHED`
- [ ] 削除を二重に押しても 200 で、同じ `deletedAt` を返す
- [ ] 名簿の `stats.deletedCount` が削除済みの件数になり、絞り込みの札「削除済み N」と一致する
- [ ] CSV に削除済みの行が出ない
- [ ] 参加者自身の取り消し（公開 API の `DELETE`）は今までどおり行を消す

### データ

- [ ] `participants.deleted_at` と `participants_event_id_deleted_at_idx` が入り、既存行は `NULL`
- [ ] 名簿の応答が `active`（`createdAt` 昇順）→ `deleted`（`deletedAt` 降順）の順で、各行に `deletedAt` を持つ

## 参考

- `prisma/schema.prisma` — `Participant`、`(event_id, user_id)` の一意制約
- `src/app/api/v1/organizer/events/[id]/participants/route.ts` — 名簿の取得と追加
- `src/app/api/v1/organizer/events/[id]/participants/[participantId]/route.ts` — 出欠の変更と論理削除
- `src/app/api/v1/organizer/events/[id]/participants/[participantId]/restore/route.ts` — 復元
- `src/app/api/v1/organizer/events/[id]/participants/[participantId]/collection/route.ts` — 集金
- `src/modules/participants/lib/where.ts` — `ACTIVE_PARTICIPANT_WHERE`
- `src/modules/participants/lib/serialize.ts` — 名簿の 1 行を組み立てる
- `src/modules/events/lib/events.ts` — `assertCapacityAllows`、`lockEventForCapacity`、`sumAttendingHeadcount`
- `src/modules/attendance/components/ParticipantListTable.tsx` — 名簿、絞り込み、CSV
- `src/modules/attendance/components/ParticipantSheet.tsx` — 追加・編集・削除済みの 1 枚
- `src/app/organizer/events/[id]/participants/page.tsx` — 保存・削除・復元の送信
- `src/styles/deco/surface.css` — `.roster__row--deleted`
