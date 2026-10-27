# 主催者にイベントカレンダー画面を追加し、ホームで紹介する

> 起票済み: [#14](https://github.com/HirofumiSato/EventKreater/issues/14)。このファイルは設計の記録として残す。

## 背景

主催者は複数の催しを並行して抱えるが、いまは主催一覧のカードしかなく、「今月どこで何があるか」「同じ日に2件入っていないか」を日付の軸で確かめられない。開催日は1イベントに最大8件入るのに、カードは先頭1件＋「ほかN件」に畳むため（`src/lib/serializers.ts:275-280`）、2件目以降の日付は一覧から読めない。

あわせて、ホームの機能紹介は5項目で、日程を俯瞰する価値が伝わっていない。

## 現状と根拠

### 画面

- 主催者画面のサブタブは「主催一覧」「売上」の2つだけ（`src/modules/organizers/components/OrganizerTabs.tsx:11-14`）。カレンダーの画面はない。
- 主催一覧はカードの縦積みで、日付の軸がない（`src/app/organizer/events/page.tsx`、`src/modules/events/components/EventCard.tsx`）。
- 売上画面は開催日で絞り込めるが、表であって月の俯瞰はできない（`src/app/organizer/revenue/page.tsx`）。

### データ

- 開催日は `EventSchedule`（`event_date` / `start_time` / `end_time`、1〜8件）。`Event.sortDate` は最も早い日（`prisma/schema.prisma`）。
- `schedules` は `eventDate`（`YYYY-MM-DD`）と `startTime` / `endTime`（`HH:mm`）で返る（`src/lib/serializers.ts:250-260`）。日付は UTC 0時の `Date` で扱うため、JST の日付ズレは起きない（同 `:117-126`）。
- 日跨ぎは `eventTime` が「18:00〜翌2:00」になる（同 `:44-52`）。カレンダーはこの文字列をそのまま使える。
- `GET /api/v1/organizer/events` は幹事のイベントを `schedules` と `stats` ごと返す（`src/app/api/v1/organizer/events/route.ts`）。表示に必要な項目は揃っている。
- ゲスト幹事も Cookie の `guestOrganizerToken` で同じ API を読める（同）。

### 方針との関係

- このアプリは不特定多数向けのイベント一覧・検索を持たない（`docs/overall_system_requirements_common.md:56`）。公開一覧 API も置かない（同 `:74`）。今回のカレンダーは自分が幹事のイベントだけを対象にし、この方針を変えない。
- ヘッダーのナビは増やさない。売上と同じくヘッダー直下の `OrganizerTabs` で行き来する（`docs/front_implementation_spec.md`）。

## 今回の決定

| 論点 | 決定 |
| :---- | :---- |
| 対象イベント | 自分が幹事（`OWNER` / `CO_HOST`）の、削除されていないイベントだけ。`DRAFT` も含める |
| 画面の置き場所 | 新規 `/organizer/calendar`（SCR-ORG-13）。`OrganizerTabs` を「主催一覧 / カレンダー / 売上」の3つにする |
| 表示形式 | 月表示＋選んだ日の予定一覧。900px 以上は2列（左に月、右に一覧）、900px 未満は1列で月の下に一覧 |
| 複数開催日 | `EventSchedule` の1件を1つの予定として、すべての日付に出す |
| 月の移動 | 前月・次月・今月。月は URL の `?month=YYYY-MM` に持たせ、再読み込みと戻るで保たれるようにする |
| 初期表示 | JST の今月。選んだ日は今日（今月でなければ1日） |
| 過去のイベント | 表示する。状態（下書き / 公開中 / 受付停止）をラベルで出す |
| 外部カレンダー連携 | 入れない。`.ics` も購読 URL も作らない |
| ゲスト幹事 | 閲覧できる。売上・名簿の 403 `REGISTER_REQUIRED` とは別扱い（一覧と同じデータの並べ替えのため） |
| 新しい API | 作らない。既存の `GET /api/v1/organizer/events` を読む |
| DB 変更 | なし |
| ホーム | `capabilities` に6項目目を足し、見出しを「6つ」に更新 |

## ゴール

1. 幹事が、自分が関わる催しを月単位で俯瞰できる。
2. 複数開催日の催しでも、すべての日付がカレンダーに出る。
3. 予定から、そのまま出欠確認か編集へ進める。
4. 一覧・検索を持たない方針と、ヘッダーの並びを変えない。
5. ホームで日程把握の価値を伝え、初見の幹事が自分のためのサービスだと理解できる。

## スコープ外

- 外部カレンダーへの書き出し・購読（`.ics`、Google カレンダー）
- 参加予定イベント（自分が参加表明した催し）の表示
- 全公開イベントの一覧・検索との統合
- 週表示・日表示・ドラッグでの日付変更
- カレンダー上での作成・複製・削除・受付停止
- 繰り返し規則（`EventSchedule` は最大8件の候補日で、RRULE を持たない）
- リマインドや通知
- 月ごとの API（`?from=&to=` の絞り込み）

## 実装方針

### 1. 画面とルーティング

- `src/app/organizer/calendar/page.tsx` を追加する。`useSearchParams()` を使うため `Suspense` の内側に `CalendarView` を置く（`/organizer/events/new` と同じ形）。
- `src/modules/organizers/components/CalendarView.tsx`（クライアント）に本体を置く。
- `OrganizerTabs` に3つ目を足す。

```tsx
const TABS = [
  { href: "/organizer/events", label: "主催一覧" },
  { href: "/organizer/calendar", label: "カレンダー" },
  { href: "/organizer/revenue", label: "売上" },
] as const;
```

- 現在地は既存どおりパスの完全一致（`aria-current="page"` と `is-current`）。
- `h1` は「カレンダー」、リードは「自分の催しを、開催日ごとに並べます。」。催し名を `h1` にしない（FE-ORG-01）。
- パネルの actions は「主催一覧へ」と「新規作成」の2本（売上画面と同じ）。
- データ取得は `GET /api/v1/organizer/events` を `cache: "no-store"` で読む。401 は一覧と同じ文言とログイン導線。
- 月を移動しても再取得しない。イベント数は利用枠で限られ、全件をクライアントで絞れば足りる。増えたときは `?from=&to=` を足す別 issue とする。

### 2. 純関数（テスト対象）

`src/modules/organizers/lib/calendar.ts` を追加する。日付は `YYYY-MM-DD` の文字列と `Date.UTC` だけで計算し、ローカルタイムの `new Date("YYYY-MM-DD")` を作らない（売上画面の `currentMonthBounds` と同じ扱い）。

| 関数 | 役割 |
| :---- | :---- |
| `currentMonth(now)` | JST の今月 `YYYY-MM` |
| `shiftMonth(month, delta)` | 12月→翌1月、1月→前年12月 |
| `isMonthKey(value)` | `YYYY-MM` として妥当か |
| `monthRange(month)` | 月初と月末の `YYYY-MM-DD` |
| `buildMonthGrid(month)` | 日曜始まりの42日。各日に `date` と `isOutside` |
| `groupSchedulesByDate(events)` | `schedules` を平坦化し、`eventDate` ごとに `{ event, schedule }[]` |
| `sortDayEntries(entries)` | `startTime` 昇順（NULL は末尾）、同時刻は `createdAt` 昇順 |
| `entriesForDate(grouped, date)` | 選んだ日の一覧 |

- 週数は6週で固定し、月によって高さが変わらないようにする。
- 存在しない日付（2月30日など）は `Date.UTC` の繰り上がりに頼らず、`range` の日数で弾く。
- 月末が日曜で5週に収まる月も6週で描く（最終週は翌月の日だけ）。

### 3. 画面の仕様

**月グリッド**

- 日曜始まり。曜日ヘッダーは「日 月 火 水 木 金 土」。
- 各セルに日番号と、その日の催し名。3件まではそのまま並べ、4件以上は2件＋`+N` の3行に収める。
- 催し名はセル幅に合わせて1行で省略し、全文は `title` 属性と、タップしたときのモーダルで補う。日番号は中央、催し名は左揃えの小さな帯にする。
- 帯はボタンにし、押すとその日の予定を選んだうえでモーダルを開く。モーダルには日付・催し名の全文・時刻/状態/場所・催しページへのリンクを出す。
- モーダルは Esc と背景のタップで閉じ、閉じたら押した帯へフォーカスを戻す。開いている間は背景のスクロールを止める。
- 公開中は `--color-primary-soft` の帯、下書き・終了は `--color-slate-100` の控えめな帯にする。
- 今日のセルに `is-today`（日番号を朱の太字）、選んだ日に `is-selected`（`--color-primary-soft` の面、日番号は朱の太字）。セルに枠線は付けず、黒地の反転もしない。
- 月外の日は数字を淡色にし、催し名も出さない（押しても移動しない）。
- セル全体は `calendar__cell-select` の `<button type="button">` にして `aria-label` に「10月22日、予定2件」、`aria-pressed` に選択状態を入れる。日番号と帯は重ねて置き、帯は別のボタンにする（ボタンの入れ子にしない）。`+N` はその日の一覧を選ぶだけにする。

**選んだ日の予定一覧**

- 見出しは「10月22日（木）」。
- 1件は「時刻 / 催し名 / 状態 / 共同主催ラベル」。
- 時刻は `schedule.eventTime`（「18:00〜翌2:00」を含む）。空なら時刻を出さない。
- 状態は `STATUS_LABELS`（下書き / 公開中 / 受付停止）。`CO_HOST` のとき「共同主催」を添える（`EventCard` と同じ語）。
- 行全体をリンクにする。`DRAFT` は `/organizer/events/[id]/edit`、それ以外は `/organizer/events/[id]/participants`。
- 出欠人数・定員・売上は出さない（一覧・売上と役割を重ねない）。
- 予定が無い日は「この日の予定はありません。」

**状態と操作**

- 前月 / 次月 / 今月のボタン。読み込み中は月グリッドを残し、`loading` の行を出す。
- 空状態は「この月に予定はありません。」と「新規作成」への1本。
- 週の開始は日曜固定。月曜始まりの設定は持たない。

**幅**

- 900px 以上は `.calendar-layout` を2列（月 / 一覧）にする。900px 未満は1列で、月の下に一覧を置く。
- 375px でセルの中身が折り返さないこと。日番号と催し名の帯を縦に積み、帯は1行で省略する（9px、入りきらない分は `+N`）。
- スタイルは `src/styles/components.css` に追加する（既存の `panel` / `card` / `chips` と同じ場所、ブレークポイントは 900px に合わせる）。

### 4. ホームとサービス紹介

`src/app/page.tsx` の `capabilities` に6項目目を足す。

```tsx
[
  "今月の予定が、1画面で分かる",
  "自分の催しをカレンダーに並べます。開催日が複数ある催しも、すべての日付で出ます。日付を選ぶと、その日の出欠確認へ進めます。",
],
```

見出しと補足を件数に合わせる。

```tsx
<h2 className="section__title">幹事の手間を、6つに減らす</h2>
<p className="section__note">告知・出欠・集計・お金・運営・日程を、1つのURLにまとめます。</p>
```

- `.feature-list` は縦積みで列数を固定していない（`src/styles/components.css`）。6件でも崩れない。
- CTA と画像は増やさない（`docs/front_implementation_spec.md` の方針）。
- カレンダーは会員・ゲストの両方が使えるため、紹介文に会員限定の注記は付けない。
- `/service` の `capabilities` にも「催しの日程をカレンダーで見る」を追加し、ホームと同じ用語にする（`src/app/service/page.tsx`）。

### 5. ドキュメント

- `docs/front_implementation_spec.md`
  - 画面表に `/organizer/calendar`（SCR-ORG-13、主催幹事、幹事トークンまたは会員JWT）を追加。
  - ルートツリーと画面カタログに SCR-ORG-13 を追加。
  - `OrganizerTabs` の説明を3つに更新し、機能紹介の「5つ」を「6つ」に直す。
  - 受け入れ条件表に FE-ORG-13 を追加。
- `docs/overall_system_requirements_common.md`
  - 画面カタログに SCR-ORG-13 を追加。主催者画面のナビゲーション記述を3つのサブタブに更新。
  - ホーム（SCR-PUB-00）の機能紹介を6項目に更新。
- DB と API の文書は変更しない（スキーマも API も増やさないため）。

### 6. テスト

- `tests/unit/organizer-calendar.test.ts` を追加する。
  - `buildMonthGrid` が日曜始まりの42日で、月初と月末の曜日が正しい（2026年10月は1日が木曜）。
  - 2月・うるう年・6週になる月（2026年8月など）で日数と `isOutside` が正しい。
  - `shiftMonth("2026-12", 1)` が `2027-01`、`shiftMonth("2026-01", -1)` が `2025-12`。
  - 複数開催日のイベントが、すべての日付に1件ずつ出る。
  - 同日の並びが `startTime` 昇順で、時刻なしが末尾になる。
  - 月外の予定が、月内の日に混ざらない。

## 受け入れ条件

### 画面

- [ ] 主催者画面のサブタブが「主催一覧 / カレンダー / 売上」の3つになり、`/organizer/calendar` で「カレンダー」だけに `aria-current="page"` が付く
- [ ] 冒頭 `h1` が「カレンダー」で、催し名が `h1` になっていない
- [ ] 初期表示が JST の今月で、今日が選ばれている
- [ ] 前月・次月・今月で移動でき、URL の `?month=YYYY-MM` が変わる。再読み込みしても同じ月が開く
- [ ] 複数開催日のイベントが、すべての日付に表示される
- [ ] 月外の日を押しても月が変わらず、予定も出ない
- [ ] 予定の行から、`DRAFT` は編集、それ以外は出欠確認へ進める
- [ ] セルの帯をタップするとモーダルが開き、催し名の全文・時刻・状態・場所が出る
- [ ] モーダルの「イベントページへ」から、`DRAFT` は編集、それ以外は出欠確認へ進める
- [ ] 下書き / 公開中 / 受付停止がラベルで分かり、共同主催の催しに「共同主催」が出る
- [ ] 日跨ぎの催しが「18:00〜翌2:00」と表示される
- [ ] 予定が無い月に「この月に予定はありません。」が出る
- [ ] 375px / 900px / 1280px で、日番号と催し名の帯が折り返さず、帯がセルからはみ出さない
- [ ] 900px 未満は1列で、予定一覧が月の下にある

### データと認可

- [ ] ログイン中の幹事は、自分が `OWNER` / `CO_HOST` のイベントだけを見られる（他の幹事のイベントは出ない）
- [ ] ゲスト幹事は Cookie の幹事トークンで自分のイベントを見られる
- [ ] 未ログインで開くと 401 になり、主催者ログインの導線が出る
- [ ] 新しい API と DB の変更がない

### ホーム

- [ ] ホームに6項目目が表示され、見出しの「6つ」と件数が一致する
- [ ] 補足が「告知・出欠・集計・お金・運営・日程」になっている
- [ ] 375px / 768px / 1280px で `feature-row` が崩れない
- [ ] CTA が増えていない（主操作は「無料でイベントを作る」のまま）
- [ ] `/service` の「できること」にも同じ用語でカレンダーが出る

### テスト

- [ ] `tests/unit/organizer-calendar.test.ts` が上記の純関数を固定している

## 参考

- `prisma/schema.prisma` — `Event`, `EventSchedule`
- `src/app/api/v1/organizer/events/route.ts` — 幹事イベントの取得
- `src/lib/serializers.ts` — `serializeEvent`, `serializeSchedules`, `scheduleLabel`, `composeEventTime`
- `src/modules/events/types.ts` — `OrganizerEvent`, `EventScheduleOption`, `STATUS_LABELS`
- `src/modules/organizers/components/OrganizerTabs.tsx` — 主催者画面のサブタブ
- `src/modules/events/components/EventCard.tsx` — 一覧カードの文言と導線
- `src/app/organizer/revenue/page.tsx` — JST の月境界と期間 UI の前例
- `src/app/page.tsx` / `src/app/service/page.tsx` — ホームとサービス紹介
- `src/styles/components.css` / `src/styles/screens/organizer.css` — 既存のスタイルとブレークポイント（900px / 768px / 640px）
- `docs/front_implementation_spec.md` — 画面表、画面カタログ、受け入れ条件
- `docs/overall_system_requirements_common.md` — 画面カタログとホームの説明
