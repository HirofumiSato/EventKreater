# 参加者にカレンダー画面を追加し、出欠した催しを日付で俯瞰できるようにする

> 起票済み: [#19](https://github.com/HirofumiSato/EventKreater/issues/19)。このファイルは設計の記録として残す。

## 背景

参加者は `/participant` と `/participant/history` で、これからの参加と過去の出欠を一覧できる。ただしどちらも回答日（`updatedAt`）や代表日（`sortDate`）を軸にした縦積みのカードで、「今月どこに何があるか」「同じ日に2件入っていないか」を日付の軸で確かめられない。

幹事には `/organizer/calendar`（SCR-ORG-13）があり、月グリッドで自分の催しを俯瞰できる。参加者側にも同じ見方があると、出欠した催しの日付を思い出す導線になる。

## 現状と根拠

### 画面

- 参加者向けの画面は `/participant`（SCR-PUB-08）、`/participant/history`（SCR-PUB-09）、`/participant/login`（SCR-PUB-07）だけ。カレンダーはない。
- 参加者ホームは「これからの参加」を最大3件、履歴は10件ずつのページ送りで出す。どちらも日付の俯瞰はできない。
- 幹事向けの月グリッドは `src/modules/organizers/components/CalendarView.tsx` にあり、日付計算は `src/modules/organizers/lib/calendar.ts` に閉じている。参加者向けに作り直すと同じ計算を二重に持つ。

### データ

- 出欠は `Participant` の1行で、`userId`・`eventId`・`status`・`scheduleId` を持つ。`@@unique([eventId, userId])` なので、1イベントにつき回答は1行だけ（`prisma/schema.prisma:690-725`）。
- `scheduleId` は出欠で選んだ日程。日程を選ばずに答えた行は `NULL` で、その場合は `Event.sortDate`（最も早い開催日）が代表日になる。
- 参加履歴 API `GET /api/v1/user/participations` はページ送り前提で、`scheduleLabel` は返すが、カレンダーに置くための日付（`YYYY-MM-DD`）は返さない。
- 日付は UTC 0時の `Date` で持つため、JST の日付ズレは起きない（`src/lib/serializers.ts:117-126`）。

### 方針との関係

- このアプリは不特定多数向けのイベント一覧・検索を持たない（`docs/overall_system_requirements_common.md`）。参加者カレンダーは「自分が出欠した催し」だけを対象にし、この方針を変えない。
- ヘッダーのナビは役割ごとに分ける。参加者画面には参加者の機能だけを並べる（`docs/front_implementation_spec.md` 第3.1節）。
- 月・日付の計算は幹事カレンダーと同じ規則（日曜始まり、6週固定、JST の今月、`?month=YYYY-MM`）に揃える。

## 今回の決定

| 論点 | 決定 |
| :---- | :---- |
| 対象イベント | 自分が出欠を答えたイベント（`Participant.userId = 自分`）。削除済み（`isDeleted`）は除く |
| 出欠の状態 | 出席（`ATTENDING`）と欠席（`DECLINED`）の両方を出す。欠席は予定として残しつつ、催し名とラベルを控えめな色にする |
| 置く日付 | 出欠で選んだ日程（`schedule.eventDate`）。日程を選んでいなければ `Event.sortDate` |
| 複数開催日 | 1つの回答は1つの日付にだけ置く。候補日すべてには広げない |
| 画面の置き場所 | 新規 `/participant/calendar`（SCR-PUB-12） |
| ヘッダー | 参加者画面のナビに「参加カレンダー」を1本足す。主催者画面のナビには出さない |
| 表示形式 | 幹事カレンダーと同じ月グリッド＋選んだ日の一覧。900px 以上は2列、未満は1列 |
| 月の移動 | 前月・次月・今月。月は URL の `?month=YYYY-MM` に持たせ、再読み込みと戻るで保たれる |
| 初期表示 | JST の今月。選んだ日は今日（今月でなければ1日） |
| 新しい API | `GET /api/v1/user/calendar` を追加する。認証は会員JWT必須（未ログインは401） |
| ページ送り | 持たない。利用者は自分の回答だけなので全件を返し、クライアントで月を切り出す |
| DB 変更 | なし |
| 外部カレンダー連携 | 入れない。`.ics` も購読 URL も作らない |

## ゴール

1. 参加者が、自分が出欠した催しを月単位で俯瞰できる。
2. 出欠で選んだ日程の日に、その催しが1件だけ出る。
3. 出席と欠席が同じ画面で区別でき、欠席も予定として思い出せる。
4. 一覧・検索を持たない方針と、主催者画面のナビを変えない。
5. 月・日付の計算を幹事カレンダーと共有し、規則がずれない。

## スコープ外

- 全公開イベントの一覧・検索との統合
- 出欠を答えていない催しの表示
- 週表示・日表示・ドラッグでの予定変更
- カレンダー上での出欠変更（行からイベントページへ進んで変更する）
- 外部カレンダーへの書き出し・購読（`.ics`、Google カレンダー）
- リマインドや通知
- 月ごとの API（`?from=&to=` の絞り込み）
- 領収書への直接リンク（一覧の行はイベントページだけ）

## 実装方針

### 1. 日付計算の共通化

- `src/lib/calendar.ts` を追加し、幹事カレンダーの月・日付の純関数を移す。
  - `WEEKDAY_LABELS`、`MONTH_GRID_DAYS`、`MonthCell`
  - `todayInTokyo`、`currentMonth`、`defaultSelectedDate`
  - `isMonthKey`、`shiftMonth`、`monthRange`、`buildMonthGrid`
  - `entriesForDate<T>`、`countMonthEntries<T>`
  - `formatMonthTitle`、`formatDayHeading`、`formatCellLabel`
- `src/modules/organizers/lib/calendar.ts` は共通関数を再エクスポートし、`groupSchedulesByDate` と `sortDayEntries` だけを持つ。幹事カレンダーの既存テストは import 先を変えずに通る。
- `src/components/common/CalendarMonth.tsx` に `CalendarToolbar` と `CalendarMonthGrid` を置き、幹事・参加者の両方の画面で使う。セルは日番号と催し名の帯（3行まで）を出し、件数の丸めは `splitCellItems` に任せる。帯のモーダルは `src/components/common/CalendarEventModal.tsx` に置く。

### 2. API

`src/app/api/v1/user/calendar/route.ts` を追加する。

```http
GET /api/v1/user/calendar
```

- `requireUserId` で認証する。未ログインは 401。
- `Participant` を `userId = 自分`、`event.isDeleted = false` で全件読み、`participationInclude`（`schedule`・`receipt`・`event`＋`flyerAsset`）で必要な項目を取る。
- 応答は次の形。日付は `schedule.eventDate`、無ければ `event.sortDate` を `YYYY-MM-DD` にする。

```json
{
  "items": [
    {
      "participantId": "…",
      "date": "2026-10-22",
      "eventTime": "18:00〜21:00",
      "status": "ATTENDING",
      "statusLabel": "出席",
      "event": {
        "id": "…",
        "title": "芋煮会",
        "location": "河原",
        "status": "PUBLISHED",
        "flyerThumbnailUrl": null
      }
    }
  ]
}
```

- 変換は `src/modules/participants/lib/participations.ts` の `serializeCalendarEntry` に置き、既存の `serializeParticipation` と `participationCalendarDate` を再利用する。
- 月の絞り込みはしない。月を移動しても再取得しない。

### 3. 純関数（テスト対象）

`src/modules/participants/lib/calendar.ts` を追加する。

| 関数 | 役割 |
| :---- | :---- |
| `sortParticipantDayEntries(entries)` | `eventTime` 昇順（空は末尾）、同時刻は催し名の五十音順、最後に `participantId` |
| `groupParticipantEntriesByDate(entries)` | `date` ごとに `ParticipantCalendarEntry[]` を作り、各日を時刻順にする |

- `participationCalendarDate(row)` はサーバー側（`participations.ts`）に置き、選んだ日程 → 代表日の順で `YYYY-MM-DD` を返す。
- 月外の予定は `groupParticipantEntriesByDate` に含め、表示側で選んだ日だけを取り出す（幹事カレンダーと同じ）。
- 週数は6週（42日）で固定し、月によって高さが変わらないようにする。

### 4. 画面の仕様

**冒頭**

- `h1` は「参加カレンダー」。リードは「出欠を答えた催しを、開催日ごとに並べます。」。
- パネルの actions は「参加者ホームへ」の1本だけ。主催一覧やイベント作成は出さない。

**月グリッド**

- 日曜始まり。曜日ヘッダーは「日 月 火 水 木 金 土」。
- 各セルに日番号と、その日の催し名。3件まではそのまま並べ、4件以上は2件＋`+N` の3行に収める。
- 催し名はセル幅に合わせて1行で省略し、全文は `title` 属性と、タップしたときのモーダルで補う。セルが狭いので、日番号は中央、催し名は左揃えの小さな帯にする。
- 今日のセルに `is-today`（日番号を朱の太字）、選んだ日に `is-selected`（`--color-primary-soft` の面、日番号は朱の太字）。セルに枠線は付けず、黒地の反転もしない。月外の日は数字を淡色にし、催し名も出さない（押しても移動しない）。
- セル全体は `calendar__cell-select` の `<button type="button">` にして `aria-label` に「10月22日、予定2件」、`aria-pressed` に選択状態を入れる。日番号と帯は重ねて置き、帯は別のボタンにする（ボタンの入れ子にしない）。
- 帯を押すとその日を選んだうえでモーダルを開く。モーダルには日付・催し名の全文・時刻/出欠/場所・`/events/[id]` への「イベントページへ」を出す。
- モーダルは Esc と背景のタップで閉じ、閉じたら押した帯へフォーカスを戻す。開いている間は背景のスクロールを止める。`+N` はモーダルではなく、その日の一覧を選ぶだけにする。

**選んだ日の予定一覧**

- 見出しは「10月22日（木）」。
- 1件は「時刻 / 催し名 / 出欠のラベル・場所」。
- 時刻は `eventTime`（「18:00〜翌2:00」を含む）。空なら「時刻未定」。
- 出欠のラベルは「出席」「欠席」。欠席の行は催し名を `--color-text-muted`、ラベルを `--color-danger-text` にする。
- 行全体をリンクにし、`/events/[id]` へ進む。出欠の変更はイベントページで行う。
- 予定が無い日は「この日に出欠した催しはありません。」。

**状態と操作**

- 前月 / 次月 / 今月のボタン。読み込み中は月グリッドを残し、`loading` の行を出す。
- 空状態は「この月に出欠した催しはありません。」。新しい催しを作る導線は出さない。
- 401 のときは「ログインが必要です。出欠の履歴を残すには、参加者としてログインしてください。」と `/participant/login` のリンクを出す。

**幅**

- 900px 以上は `.calendar-layout` を2列（月 / 一覧）にする。900px 未満は1列で、月の下に一覧を置く。
- 375px でセルの中身が折り返さないこと。日番号と催し名の帯を縦に積み、帯は1行で省略する（9px、入りきらない分は `+N`）。
- スタイルは `src/styles/components.css` の既存の `.cal` ブロックを再利用し、欠席の色だけ足す。

### 5. ナビゲーション

- `src/lib/site.ts` の `SITE.nav` に `participantCalendar`（「参加カレンダー」、`/participant/calendar`）を追加する。
- `src/components/common/Navbar.tsx` の参加者ナビを「参加者ホーム / 参加カレンダー / 参加履歴 / アカウント」の順にする。主催者ナビは変えない。
- 現在地はパスの完全一致（`aria-current="page"` と `is-current`）。`/participant` と `/participant/calendar` を区別する。

### 6. ドキュメント

- `docs/front_implementation_spec.md`
  - 画面表に `/participant/calendar`（SCR-PUB-12、参加者、会員JWT必須）を追加。
  - 画面カタログ、ルートツリー、Mermaid 図に SCR-PUB-12 を追加。
  - ヘッダーの出し分け表と現在地の説明を「参加者ホーム / 参加カレンダー / 参加履歴 / アカウント」に更新。
  - 受け入れ条件に FE-PUB-13 を追加。
- `docs/overall_system_requirements_common.md`
  - `SITE.nav` の表、ヘッダーの出し分け表、画面カタログ、ルートツリー、Mermaid 図に SCR-PUB-12 を追加。
- DB と API の既存契約は変更しない（新しい読み取り API を1本足すだけ）。

### 7. テスト

- `tests/unit/participant-calendar.test.ts` を追加する。
  - 選んだ日程の日付を使い、日程が無ければ代表日に置く（`participationCalendarDate`）。
  - 1つの回答が1つの日付にだけ出る。
  - 同じ日の出席と欠席が時刻順に並ぶ。
  - 時刻の無い催しが末尾、同時刻は催し名順。
  - 月外の回答を月内の件数に数えない。
  - `defaultSelectedDate` が今月なら今日、別の月なら1日を返す。
- 既存の `tests/unit/organizer-calendar.test.ts` は共通化後もそのまま通ること。

## 受け入れ条件

### 画面

- [ ] 参加者画面のヘッダーが「参加者ホーム / 参加カレンダー / 参加履歴 / アカウント」になり、`/participant/calendar` で「参加カレンダー」だけに `aria-current="page"` が付く
- [ ] 主催者画面のヘッダーに「参加カレンダー」が出ない
- [ ] 冒頭 `h1` が「参加カレンダー」で、催し名が `h1` になっていない
- [ ] 初期表示が JST の今月で、今日が選ばれている
- [ ] 前月・次月・今月で移動でき、URL の `?month=YYYY-MM` が変わる。再読み込みしても同じ月が開く
- [ ] 出欠で選んだ日程の日にだけ予定が出て、選んでいない候補日には出ない
- [ ] 日程を選ばずに答えた催しが、代表日のセルに出る
- [ ] 出席と欠席の両方が一覧に出て、欠席は控えめな色で表示される
- [ ] 出席の催しがセルの帯に出て、欠席は控えめな色の帯になる
- [ ] 4件以上ある日は2件＋`+N` で3行に収まり、選ぶと一覧で全件を確認できる
- [ ] 帯をタップするとモーダルが開き、催し名の全文・時刻・出欠・場所が出る
- [ ] モーダルの「イベントページへ」から `/events/[id]` に進める
- [ ] モーダルは Esc と背景のタップで閉じ、閉じると押した帯にフォーカスが戻る
- [ ] 月外の日を押しても月が変わらず、予定も出ない
- [ ] 日跨ぎの催しが「18:00〜翌2:00」と表示される
- [ ] 予定の行から `/events/[id]` へ進める
- [ ] 予定が無い月に「この月に出欠した催しはありません。」が出る
- [ ] 375px / 900px / 1280px で、日番号と催し名の帯が折り返さず、帯がセルからはみ出さない
- [ ] 900px 未満は1列で、予定一覧が月の下にある

### データと認可

- [ ] ログイン中の参加者は、自分が出欠した催しだけを見られる（他の参加者の回答は出ない）
- [ ] 出席・欠席の両方が返る
- [ ] 削除済みのイベントは出ない
- [ ] 未ログインで開くと 401 になり、参加者ログインの導線が出る
- [ ] DB の変更がない
- [ ] `GET /api/v1/user/calendar` が `participantId` / `date` / `eventTime` / `status` / `statusLabel` / `event` を返す

### テスト

- [ ] `tests/unit/participant-calendar.test.ts` が上記の純関数を固定している
- [ ] `tests/unit/organizer-calendar.test.ts` が共通化後も通る

## その後の変更

月グリッドの帯を、主催者カレンダーと同じ扱いにした（`src/styles/deco/surface.css`）。1 行で省略せず折り返して全文を出し、塗りは凡例の点に合わせる（公開中・出席は `--pop-warm`、下書き・受付停止・欠席は `--color-text-subtle`、参加要望は `--color-warning-line`）。今日の面は墨地の反転をやめ、`--color-primary-soft` の淡い面にした。日別の一覧を持つ点は変えていない。

## 参考

- `prisma/schema.prisma` — `Event`, `EventSchedule`, `Participant`
- `src/app/api/v1/user/participations/route.ts` — 参加履歴 API（ページ送り）
- `src/modules/participants/lib/participations.ts` — `participationInclude`、`serializeParticipation`
- `src/modules/participants/types.ts` — `ParticipantCalendarEntry`
- `src/modules/organizers/lib/calendar.ts` — 幹事カレンダーの予定のまとめ
- `src/modules/organizers/components/CalendarView.tsx` — 幹事カレンダーの画面
- `src/components/common/CalendarMonth.tsx` — 共通の月グリッドとツールバー
- `src/lib/calendar.ts` — 共通の日付計算
- `src/styles/screens/organizer.css` — `.cal` のスタイル
- `docs/front_implementation_spec.md` — 画面表、画面カタログ、ヘッダー、受け入れ条件
- `docs/overall_system_requirements_common.md` — 画面カタログとヘッダーの出し分け
