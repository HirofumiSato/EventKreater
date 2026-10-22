# 定員に達した催しを「参加要望」として受け付け、幹事が承認できるようにする

> 起票済み: [#20](https://github.com/HirofumiSato/EventKreater/issues/20)。このファイルは設計の記録として残す。

## 背景

催しの定員（`Event.capacity`）に達すると、いまは出欠の送信が 409 `CAPACITY_REACHED` で弾かれる（`src/modules/events/lib/events.ts:406-434`）。利用者は「出席」を選んで送信したあとに初めて断られ、代わりの手段が無い。幹事から見ても、定員に達したあとに興味を持った人がいたことが分からない。

定員に達したあとの申し込みを「参加要望」として残せれば、幹事は空きが出たときに待ち順で承認でき、利用者は「入れなかった」ではなく「順番待ちしている」状態を持てる。

あわせて、件数を数えてから作成する現在の実装には、同時送信で定員を超え得る競合がある。要望を足すと同じ競合が定員超過に直結するため、判定をトランザクション内の行ロックへ寄せる。

## 現状と根拠

### データ

- 出欠は `Participant` の1行で、`status` は `RsvpStatus`（`ATTENDING` / `DECLINED`）の2値（`prisma/schema.prisma:77-80`）。
- `@@unique([eventId, userId])` のため、1イベントにつき回答は1行だけ（`prisma/schema.prisma:719`）。会員と端末の名寄せは `chooseRsvpTarget` に閉じている（`src/modules/participants/lib/rsvp.ts:43-60`）。
- 定員は `Event.capacity`（`Int?`）。`null` は無制限。
- 売上・領収書は `status === "ATTENDING"` の行だけを見る（`src/modules/revenue/lib/revenue.ts`、`src/app/api/v1/organizer/events/[id]/participants/[participantId]/receipt/route.ts:58`）。

### 画面

- 出欠フォームは「出席 / 欠席」の2択で、`status === "ATTENDING"` のときだけ性別・日時・費用プランを出す（`src/modules/attendance/components/DynamicRsvpBox.tsx:105-198`）。
- 名簿は「参加 / 不参加 / 回答」の3集計で、行の状態は2値の三項演算子で出している（`src/modules/attendance/components/ParticipantListTable.tsx:43,179-184`）。
- 参加者ホーム・履歴・カレンダーも「出席 / 欠席」の二択で表示する（`src/app/participant/page.tsx:120`、`src/app/participant/history/page.tsx:43`、`src/modules/participants/lib/participations.ts:76`）。
- 色は緑（出席）・赤（欠席）・アンバー（`--color-warning-*`）が既にあり、`.choice--tentative` と `.badge--tentative` が未使用で残っている（`src/app/attendance.css:1270,1311`）。

### 方針との関係

- 出欠に会員登録は要らない。要望も同じ扱いとし、端末 Cookie と会員 JWT の両方で受け付ける。
- 参加費の集金と決済は行わない。要望は売上にも領収書にも入れない。

## 今回の決定

| 論点 | 決定 |
| :---- | :---- |
| 状態 | `RsvpStatus` に `WAITLISTED`（参加要望）を追加する。3値にする |
| 待ち順 | `Participant.waitlistedAt` を追加し、`waitlistedAt ASC, createdAt ASC, id ASC` で決める |
| 要望の条件 | サーバーは空きがあっても `WAITLISTED` を受け付ける。画面は満員のときだけ出す（送信直前の競合で失敗させないため） |
| 出席の条件 | `ATTENDING` は定員を超える場合、409 で断らず `WAITLISTED` へ読み替えて受け付ける（画面を開いた直後に最後の1席が埋まる競合を吸収する） |
| 要望で受け取る項目 | 名前とコメントだけ。性別・日時・費用プランは受け取らない（`waitlistedAt` 以外は `null`） |
| 承認 | 幹事が名簿の「参加要望」欄から手動で行う。承認時に出席日時と費用プランを必須にし、定員を再確認する |
| 辞退 | 幹事は `DECLINED` に更新する。行は残し、本人が結果を見られるようにする |
| 自動繰り上げ | 行わない。出席者が辞退しても要望は自動で出席にならない |
| 既に出席している人 | 満員になっても出席のまま変更・取消できる（席は確保済み） |
| 参加者側の表示 | 参加者ホーム・履歴・カレンダーに「参加要望中」を出す。カレンダーにも置く |
| 主催者ページ | 満員でも掲載し、バッジを「参加要望受付中」にする |
| 色 | 出席=緑、欠席=赤、参加要望=アンバー（既存の `--color-warning-*` と `badge--tentative` / `choice--tentative` を使う。新しい色は増やさない） |
| 通知 | 作らない（メールもプッシュもしない） |
| 上限 | 要望の人数に上限を設けない |
| DB | `RsvpStatus` の値追加と `waitlisted_at` 列・索引の追加。既存行のバックフィルは無し |

## ゴール

1. 定員に達した催しで、利用者が「参加要望」を出せる。
2. 幹事が待ち順を確認し、承認・辞退できる。
3. 要望が参加人数・売上・領収書に混ざらない。
4. 参加者・幹事の双方で、3つの状態が色とラベルで区別できる。
5. 同時送信で定員を超えない。

## スコープ外

- 自動繰り上げ（空きが出たときの自動承認）
- 承認・繰り上げのメール通知やプッシュ通知
- 要望の人数上限、要望の期限
- 要望時の希望日時・費用プランの事前入力
- キャンセル待ちの順番を参加者へリアルタイムに配信すること（応答時点の順番だけ返す）
- 主催者ページ（`/organizers/[userId]`）の新設。別 issue で扱い、本 issue は満員時の表示条件に必要な `isFull` / `acceptsWaitlist` を API に足すところまでとする
- 参加費の集金・決済

## 実装方針

### 1. DB

```prisma
enum RsvpStatus {
  ATTENDING
  DECLINED
  WAITLISTED
}

model Participant {
  // ...既存
  /// 参加要望を出した日時。承認順に使う。出席・欠席に戻すと NULL。
  waitlistedAt DateTime? @map("waitlisted_at") @db.Timestamptz

  @@index([eventId, status, waitlistedAt])
}
```

`prisma/migrations/20261022140000_participant_waitlist/migration.sql`

```sql
ALTER TYPE "RsvpStatus" ADD VALUE IF NOT EXISTS 'WAITLISTED';
ALTER TABLE "participants" ADD COLUMN "waitlisted_at" TIMESTAMPTZ;
CREATE INDEX "participants_event_id_status_waitlisted_at_idx"
  ON "participants"("event_id", "status", "waitlisted_at");
```

- 既存行は `ATTENDING` / `DECLINED` のままで、`waitlisted_at` は `NULL`。バックフィル不要。
- 新しい enum 値を同じトランザクションで使わないため、`ADD VALUE` と列追加を1つのマイグレーションにまとめられる。

### 2. 状態遷移

| 現在 | 操作 | 次 | 付随処理 |
| :---- | :---- | :---- | :---- |
| なし | 空きあり・出席 | `ATTENDING` | 日時・プラン・金額の写しを保存、`waitlistedAt = null` |
| なし | 空きあり・欠席 | `DECLINED` | 同上（日時・プランは `null`） |
| なし | 満員・参加要望 | `WAITLISTED` | `waitlistedAt = now`、日時・プラン・金額は `null` |
| なし | 満員・出席（競合） | `WAITLISTED` | 409 で断らず要望へ読み替え、`waitlistedAt = now` |
| なし | 満員・幹事が出席で追加 | 409 `CAPACITY_REACHED` | 幹事の明示的な追加は席を超えさせない |
| `WAITLISTED` | 取り消し（DELETE） | 行を削除 | 既存の DELETE をそのまま使う |
| `WAITLISTED` | 欠席に変更 | `DECLINED` | `waitlistedAt = null` |
| `WAITLISTED` | 空きが出て出席に変更 | `ATTENDING` | 定員・日時・プランを再確認 |
| `WAITLISTED` | 幹事が承認 | `ATTENDING` | 定員を再確認し、日時・プランを指定。`waitlistedAt = null` |
| `WAITLISTED` | 幹事が辞退 | `DECLINED` | 行は残す |
| `ATTENDING` | 満員後に本人が変更 | `ATTENDING` / `DECLINED` | 要望に落とさない |

### 3. 共通関数

`src/modules/events/lib/rsvp-status.ts` を追加する。

| 関数 | 役割 |
| :---- | :---- |
| `RSVP_STATUS_LABELS` | `ATTENDING: "出席"` / `DECLINED: "欠席"` / `WAITLISTED: "参加要望中"` |
| `rsvpStatusLabel(status)` | ラベルを返す。3値の三項演算子を1か所に閉じる |
| `rsvpStatusTone(status)` | `"attending" \| "declined" \| "waitlist"`。CSS クラス名に使う |
| `isWaitlisted(status)` | 要望か |
| `waitlistPosition(rows, participantId)` | `waitlistedAt` 昇順で1始まり。要望でなければ `null` |
| `nextRsvpChoices(input)` | 画面の選択肢を決める（下の表） |

`nextRsvpChoices({ capacity, attendingCount, myStatus })`

| 条件 | 選択肢 |
| :---- | :---- |
| `myStatus === "ATTENDING"` | 出席 / 欠席（満員でも席は確保済み） |
| `capacity === null` | 出席 / 欠席 |
| `remainingSeats > 0` | 出席 / 欠席（要望中なら出席へ変更できる） |
| 満員 | 要望 / 欠席 |

### 4. API

| エンドポイント | 変更 |
| :---- | :---- |
| `POST /api/v1/public/events/[id]/rsvp` | `status` に `WAITLISTED` を追加。要望では日時・プラン不要。応答に `waitlistPosition` |
| `GET /api/v1/public/events/[id]` | `waitlistCount` / `remainingSeats` / `isFull` / `acceptsWaitlist` を追加。`myRsvp.waitlistPosition` を追加 |
| `GET /api/v1/organizer/events/[id]/participants` | `stats.waitlistedCount`、各行の `waitlistedAt` / `waitlistPosition` |
| `PATCH /api/v1/organizer/events/[id]/participants/[participantId]` | `status` に `WAITLISTED` を許可。承認は `ATTENDING` + 日時 + プラン必須 |
| `GET /api/v1/user/participations` | `status` フィルタに `WAITLISTED`、`summary.waitlisted` を追加 |
| `GET /api/v1/user/calendar` | 要望も返す（`statusLabel: "参加要望中"`） |

**定員の同時制御**

`assertCapacityAllows`（`src/modules/events/lib/events.ts:406-434`）の前に、対象イベント行をロックする。

```ts
await tx.$queryRaw`SELECT id FROM "events" WHERE id = ${eventId}::uuid FOR UPDATE`;
```

数えてから作るまでの間に他のトランザクションが割り込めなくなり、同時送信でも定員を超えない。ロックは出欠の送信と幹事の承認の両方で取る。

**応答例**

```json
{
  "attendingCount": 2,
  "waitlistCount": 3,
  "capacity": 2,
  "remainingSeats": 0,
  "isFull": true,
  "acceptsWaitlist": true,
  "myRsvp": { "status": "WAITLISTED", "waitlistPosition": 2 }
}
```

### 5. 画面

**告知ページ（`DynamicRsvpBox`）**

- 満員のときは「出席」を出さず、「参加要望 / 欠席」の2択にする。見出しは「定員に達しました」、リードは「空きが出たら、幹事が順番に承認します。」。
- 要望では名前とコメントだけを入力する。性別・日時・費用プランは出さない。
- 送信後は「参加要望を受け付けました。空きが出たら幹事が承認します。（N番目）」。
- 自分が `WAITLISTED` のときは現在の状態と順番を出し、取り消しと欠席への変更を選べる。
- `EventMetaCard` の参加欄は「参加 2名 / 定員 2名（満員・参加要望を受付中）」。
- `StickyRsvpBar` は「参加 2名 · 要望 3名 · 定員 2名」。

**名簿（`ParticipantListTable`）**

- 絞り込みを「すべて / 参加 / 参加要望 / 不参加」の4つにし、件数を添える。
- 参加要望どうしは待ち順（`waitlistPosition` 昇順）で並べ、名前に「待ち N番目」を出す。
- 参加要望の行には「承認」ボタンを出し、出席日時と費用プランを選んで保存する。満員なら 409 を表示して再読み込みする。
- 日時の列には、要望なら `waitlistedAt`（要望日時）を出す。
- 「変更」からは出席・参加要望・欠席の3状態へ変更できる。辞退は `DECLINED` に更新し、行は残す。
- CSV の「状態」列に「参加要望」を出す。

**参加者側**

- 参加者ホーム・履歴・カレンダーに「参加要望中」バッジ（アンバー）。
- 参加者ホームの集計に「参加要望」を1つ追加する。

**色**

| 状態 | クラス |
| :---- | :---- |
| 出席 | `badge--attending` / `choice--attending`（緑・既存） |
| 欠席 | `badge--declined` / `choice--declined`（赤・既存） |
| 参加要望 | `badge--waitlist` / `choice--waitlist`（アンバー。`--color-warning-*` を使い、`badge--tentative` / `choice--tentative` と同じ値） |
| カレンダーの短冊 | `.calendar__event.is-waitlist`（追加） |
| カレンダーの行 | `.calendar-day__item.is-waitlist` / `.calendar-day__meta--waitlist`（追加） |

`src/lib/calendar.ts` の `CalendarCellItem.tone` を `"default" | "muted" | "waitlist"` に広げる。

### 6. テスト

**単体 `tests/unit/rsvp-status.test.ts`**

- `rsvpStatusLabel` が3値で「出席 / 欠席 / 参加要望中」を返す。
- `summarizeStatuses` が `waitlistedCount` を数え、`totalResponses` が3値の合計になる。
- `waitlistPosition` が `waitlistedAt` 昇順で1始まり、要望でなければ `null`、同時刻は `createdAt` で安定する。
- `nextRsvpChoices` が上の表どおりになる（満員・空きあり・定員なし・自分が出席・自分が要望）。

**単体（既存の更新）**

- `tests/unit/organizer-calendar.test.ts` / `tests/unit/participant-calendar.test.ts` の `stats` に `waitlistedCount: 0` を足す。
- `tests/unit/revenue.test.ts` に「要望は売上に入らない」を1件追加する。

**結合 `tests/integration/waitlist.test.ts`**

- 定員2・出席2で3人目の `ATTENDING` が `WAITLISTED` に読み替えられ、`attendingCount` は2のまま、`waitlistedAt` が入る。
- 同じ3人目の `WAITLISTED` が 201 で、`attendingCount` は2のまま、`waitlistedAt` が入る。
- 4人目の要望が `waitlistPosition = 2`。
- 幹事が1人目を承認すると `ATTENDING` / `waitlistedAt = null` になり、2人目の位置が1へ繰り上がる。
- 満員のまま承認すると 409。
- 出席者が取り消しても要望は自動で出席にならない。
- 要望は領収書を発行できない。
- 要望は名簿の `stats.waitlistedCount` に入り、売上に入らない。
- 参加履歴が「参加要望中」で返り、`summary.waitlisted` が1。
- 参加カレンダーに要望が出る。

### 7. ドキュメント

- `docs/overall_system_requirements_common.md` に参加要望の定義と状態遷移を追記する。
- `docs/front_implementation_spec.md` の出欠・名簿の記述を3状態に更新し、受け入れ条件を追加する。
- `src/app/api/v1/organizer/events/[id]/participants/[participantId]/route.ts` と `reminders/route.ts`、`receipt/route.ts` に残る文字化け（`"?????????????"`）を、触る範囲で日本語に戻す。

## 受け入れ条件

### 出欠

- [ ] 定員に達した催しで、出欠フォームに「出席」が出ず「参加要望 / 欠席」になる
- [ ] 「参加要望」では名前とコメントだけを入力でき、日時・費用プランは聞かれない
- [ ] 送信後に「参加要望を受け付けました（N番目）」と出る
- [ ] 要望は参加人数に数えられず、売上・領収書にも入らない
- [ ] 自分の要望を取り消せる
- [ ] 既に出席している人は、満員になっても出席のまま変更・取消できる
- [ ] 空きがある催しでは従来どおり「出席 / 欠席」で、要望は出ない
- [ ] 定員が未設定の催しでは要望を出さない
- [ ] 満員の催しで「出席」を送っても 409 にならず、参加要望として受け付けられる（画面の競合時）
- [ ] 同時送信で定員を超えない

### 幹事

- [ ] 名簿の絞り込みに「参加要望（N）」があり、待ち順で並ぶ
- [ ] 承認は出席日時と費用プランを選ばないと実行できない
- [ ] 満員のまま承認しようとすると 409 になり、画面に理由が出る
- [ ] 辞退すると `DECLINED` になり、行は残る
- [ ] 集計が「参加 / 不参加 / 参加要望 / 回答」の4つになる
- [ ] 出席者が辞退しても要望は自動で出席にならない
- [ ] CSV の状態列に「参加要望中」が出る

### 参加者側

- [ ] 参加者ホーム・履歴・カレンダーに「参加要望中」が出る
- [ ] 参加者ホームの集計に「参加要望」がある

### 色

- [ ] 出席は緑、欠席は赤、参加要望はアンバーで、バッジ・選択肢・カレンダーの短冊・行が揃う
- [ ] 参加要望の文字色は `--color-warning-text` で、背景とのコントラストが 4.5:1 以上ある

### データ

- [ ] 既存の出欠行が `ATTENDING` / `DECLINED` のままで、`waitlisted_at` は `NULL`
- [ ] `GET /api/v1/public/events/[id]` が `waitlistCount` / `remainingSeats` / `isFull` / `acceptsWaitlist` を返す
- [ ] `GET /api/v1/user/participations` が `summary.waitlisted` を返す

## 参考

- `prisma/schema.prisma` — `RsvpStatus`、`Participant`、`Event.capacity`
- `src/modules/events/lib/events.ts` — `assertCapacityAllows`、`resolveAttendanceChoice`、`keepPriceSnapshot`
- `src/app/api/v1/public/events/[id]/rsvp/route.ts` — 出欠の送信と取り消し
- `src/modules/attendance/components/DynamicRsvpBox.tsx` — 出欠フォーム
- `src/modules/attendance/components/ParticipantListTable.tsx` — 名簿
- `src/lib/serializers.ts` — `summarizeStatuses`、`serializeEvent`
- `src/modules/revenue/lib/revenue.ts` — 売上の集計
- `src/app/attendance.css` — `badge--tentative`、`choice--tentative`、`--color-warning-*`
