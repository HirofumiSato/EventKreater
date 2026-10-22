# 参加者が主催者のイベントカレンダー・一覧を見られる公開ページを作る

> 起票済み: [#21](https://github.com/HirofumiSato/EventKreater/issues/21)。このファイルは設計の記録として残す。

## 背景

いま参加者が触れるのは、主催者から受け取った告知URL（`/events/[id]`）だけである。同じ主催者が次にどんな催しを開くのかは分からず、主催者も「この人の催しならまた行きたい」という参加者を拾えない。主催者名から辿れる公開ページがあれば、参加者は次の予定をまとめて確認でき、主催者は告知URLを配り直さずに済む。

主催者側には、自分が参加者からどう見えているかを確認する手段が無い。公開ページをそのまま見せるプレビューを用意し、レイアウトや掲載条件の確認を1画面で完結させる。

## 決定

| 論点 | 決定 |
| :---- | :---- |
| 閲覧条件 | ログイン済みの参加者だけが中身を見られる。URLは誰でも開けるが、未ログインにはぼかした骨組みと「参加者登録・ログイン後に閲覧できます」を出す |
| 掲載する催し | `status = PUBLISHED` かつ未削除。`CLOSED`（受付停止）と申し込み期限を過ぎたものは出さない |
| 満員の催し | 出さないのではなく掲載し、「参加要望受付中」のバッジを付ける（#20 の参加要望と揃える） |
| 対象の主催者 | 筆頭幹事だけでなく、共同主催として紐づく催しも含める |
| URL | `/organizers/[userId]`。`userId` は会員の UUID |
| 画面構成 | 「カレンダー / 一覧」の2タブ。`?view=calendar|list` で切り替え、既定はカレンダー |
| カレンダー | 催しの全開催日をそれぞれの日に置く。月は今月以降だけを移動でき、過去月へは戻れない |
| 一覧 | 次に開催される日が近い順。過去の日付だけの催しは出さない |
| 1件の情報 | チラシ画像、催し名、開催日時（全候補）、場所、定員と参加人数、費用、満員・要望の状態 |
| 参加者の導線 | 参加者ホームのカードと、主催者の催しの告知ページ「主催」欄からリンクする |
| 主催者の導線 | 主催イベント一覧から自分の公開ページを開く／URLをコピーする。同じ画面でプレビューを開ける |
| プレビュー | モーダルでログイン済みの見え方を表示する。未ログインのぼかし表示はプレビューに含めない |
| 自動テスト | 掲載条件・並び・カレンダー配置・月の下限を単体で、APIの認可と掲載条件を結合で確認する |

## ゴール

1. ログイン済みの参加者が `/organizers/[userId]` で主催者の催しをカレンダーと一覧の両方から確認できる。
2. 未ログインの人には中身が見えず、登録・ログインへの案内だけが出る。
3. 主催者が自分のページのURLをコピーし、参加者から見える形をプレビューできる。
4. 受付停止・期限切れの催しが出ず、満員の催しは参加要望受付中として出る。

## スコープ外

- 主催者のプロフィール文・SNSリンク・フォロー機能
- 催しの検索・絞り込み・ページ送り（1主催者の催しは一覧で足りる）
- 主催者ページ自体のSEO最適化（`noindex` とし、検索には出さない）
- 未ログイン者への部分的開示（催し名だけ見せる等）
- 通知（新しい催しが追加されたときのメールやプッシュ）

## 実装方針

### 1. API

`GET /api/v1/public/organizers/[userId]`

- 未ログインは 403 `LOGIN_REQUIRED`（中身は返さない）。
- `users.deletedAt` が入っている会員は 404。
- その会員が `OWNER` または `CO_HOST` として紐づく催しのうち、未削除・`PUBLISHED`・`isRsvpAccepting` を満たすものを返す。
- 応答は主催者名と催しの配列。催しは `serializeEvent` の公開項目に、参加人数・定員・満員・要望受付を足した形にする。
- 掲載条件と並びは `src/modules/organizers/lib/public-page.ts` の純粋関数へ寄せ、APIと画面で同じ判定を使う。

```json
{
  "organizer": { "userId": "…", "name": "佐藤" },
  "events": [
    {
      "id": "…",
      "title": "朝ヨガ",
      "schedules": [{ "id": "…", "eventDate": "2026-11-03", "eventTime": "07:00〜08:00" }],
      "location": "公園",
      "capacity": 20,
      "attendingCount": 18,
      "remainingSeats": 2,
      "isFull": false,
      "acceptsWaitlist": false,
      "flyerAsset": { "imageUrl": "…" }
    }
  ]
}
```

### 2. 共通関数 `src/modules/organizers/lib/public-page.ts`

| 関数 | 役割 |
| :---- | :---- |
| `upcomingSchedules(event, today)` | 今日以降の開催日だけを返す |
| `isPubliclyListed(event, today)` | `PUBLISHED`・未削除・出欠受付中・今日以降の開催日がある、の4条件 |
| `nextScheduleDate(event, today)` | 次に開催される日。無ければ `null` |
| `sortOrganizerEvents(events, today)` | 次の開催日が近い順。同日は催し名の五十音順 |
| `groupOrganizerEventsByDate(events, today)` | 開催日ごとの催し。同じ日に複数候補があれば時刻順 |
| `toOrganizerCellItem(event, schedule)` | カレンダーの短冊。満員は `tone: "waitlist"` |
| `clampMonth(month, minMonth)` | 今月より前を選ばせない |

### 3. 画面

`src/app/organizers/[userId]/page.tsx`（サーバー）→ `OrganizerPageView`（クライアント）。

- 未ログイン（401/403）: 見出しだけ出し、本文は `aria-hidden` の骨組みをぼかす。案内文と参加者ログインへのボタンを重ねる。中身のAPIは呼ばない。
- ログイン済み: 主催者名、タブ、カレンダーまたは一覧。
- カレンダー: 既存の `CalendarMonthGrid` / `CalendarToolbar` を使う。前月ボタンは今月で止める。短冊を押すと `CalendarEventModal` から催しページへ進める。
- 一覧: カードにチラシ、催し名、全開催日、場所、費用、定員と参加人数、満員なら「参加要望受付中」を出す。
- 空: 「これから開催される催しはありません。」
- `noindex` は `robots.ts` かページの `metadata` で指定する。

### 4. 主催者側

- `GET /api/v1/organizer/events` の応答に `viewer.userId` を足す。
- 主催イベント一覧の冒頭に「公開ページ」ボタン（新しいタブ）と「URLをコピー」を置く。
- `OrganizerPagePreviewModal` を作り、`OrganizerPageView` を `preview` モードで描く。プレビューはログイン済みの見え方だけを出し、未ログインのぼかしは出さない。
- 各 `EventCard` の「公開ページ」の隣に「主催者のページ」を足す（その催しの筆頭幹事の `userId` を使う。`ownerUserId` を `OrganizerEvent` に足す）。

### 5. 参加者側

- 告知ページの「主催」欄の名前を `/organizers/[userId]` へのリンクにする（`userId` があるときだけ）。
- 参加者ホームのカードに「主催者のほかの催し」リンクを足す。
- 参加者カレンダーの短冊色に `waitlist` を足す（#20 の参加要望と揃える）。

### 6. テスト

**単体 `tests/unit/public-organizer-page.test.ts`**

- `isPubliclyListed` が `DRAFT` / `CLOSED` / 期限切れ / 過去のみ / 削除済みを落とす。
- `upcomingSchedules` が過去日を落とし、複数候補を全部返す。
- `sortOrganizerEvents` が次の開催日順、同日は名前順。
- `groupOrganizerEventsByDate` が同じ催しを複数の日へ置く。
- `clampMonth` が今月より前を今月へ戻す。
- `toOrganizerCellItem` が満員を `tone: "waitlist"` にする。

**結合 `tests/integration/public-organizer-page.test.ts`**

- 未ログインは 403 で催しを返さない。
- 筆頭幹事と共同主催の催しが両方返る。
- `CLOSED` と期限切れは返らない。
- 退会済みの会員は 404。

### 7. ドキュメント

- `docs/overall_system_requirements_common.md` の画面一覧・UC に公開主催者ページを足す。
- `docs/front_implementation_spec.md` の画面一覧・ディレクトリ構成・受け入れ条件を更新する。

## 受け入れ条件

- [x] ログイン済みの参加者が `/organizers/[userId]` を開くと、主催者名と催しが出る
- [x] 未ログインで開くと、中身が読めないぼかしの上に「参加者登録・ログイン後に閲覧できます」が出る
- [x] カレンダーと一覧をタブで切り替えられ、URLのクエリに残る
- [x] カレンダーは全開催日に催しが並び、今月より前へ戻れない
- [x] 一覧は次に開催される日が近い順で、過去だけの催しは出ない
- [x] `CLOSED` と申し込み期限切れの催しは出ない
- [x] 満員の催しは「参加要望受付中」として出る
- [x] 共同主催の催しも出る
- [x] 告知ページの主催者名から公開ページへ進める
- [x] 主催イベント一覧から自分の公開ページを開け、URLをコピーできる
- [x] 主催イベント一覧のプレビューで、ログイン済みの見え方を確認できる
- [x] 退会済みの会員のページは 404

## 参考

- `src/app/api/v1/public/events/[id]/route.ts` — 公開告知の読み取りと参加人数の集計
- `src/lib/serializers.ts` — `serializeEvent`、`isRsvpAccepting`、`serializePublicOrganizerList`
- `src/lib/calendar.ts` — 月グリッド・月キー・日付計算
- `src/components/common/CalendarMonth.tsx` — 主催者・参加者カレンダーと共有する部品
- `src/modules/participants/components/ParticipantCalendarView.tsx` — 参加者カレンダーの実装例
- `src/modules/events/components/EventMetaCard.tsx` — 告知ページの主催欄
- `src/app/organizer/events/page.tsx` — 主催イベント一覧とプレビューの置き場
