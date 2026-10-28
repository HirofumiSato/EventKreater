# 主催者自身の紹介ページと、その入力・編集画面を作る

> 主催者の催しページ（[#21](https://github.com/HirofumiSato/EventKreater/issues/21) / [public-organizer-page.md](public-organizer-page.md)）から、対外的なプロフィールを分離した issue。
>
> **その後の変更:** プロフィールと催しは1画面に統合し、`/organizers/[userId]`（SCR-PUB-14）の上からプロフィール、カレンダー、一覧を縦に並べる。旧 `/organizers/[userId]/events` は統合ページへの `permanentRedirect` にした。`eventsPath` は廃止し、`?view` も持たない。公開ページの共通ヘッダーは出さない。リンクは X と Instagram のアイコンだけを出し、Webサイトと LINE は公開しない。未ログインの催しは、飾りのカレンダーの上に白塗りを重ねて案内する。以下の決定は統合前の記録として残す。

## 背景

告知ページ（`/events/[id]`）には主催者名しか出ない。参加者は「どんな人が開いている催しなのか」を知らないまま申し込むことになり、初めての参加ほど不安が残る。主催者も、屋号や活動の雰囲気、ふだんの活動エリアやSNSを伝える場所を持っていない。

催しの一覧（カレンダー）は別 issue で作っている。ここで作るのは「その人自身」のページであり、催しの一覧はその下の節として分ける。主催者が内容を書ける編集画面も、主催者ホームから開けるようにする。

## 決定

| 論点 | 決定 |
| :---- | :---- |
| プロフィールの URL | `/organizers/[userId]`（SCR-PUB-14）。`userId` は会員の UUID |
| 催し一覧の URL | `/organizers/[userId]/events`（SCR-PUB-13）。プロフィールから「催しを見る」で進む |
| 編集画面の URL | `/organizer/profile`（SCR-ORG-14）。主催者エリアのサブタブと `/mypage` から開く |
| 主催者ホーム | `/mypage`（SCR-PUB-03）のまま。呼び名と役割は変えない |
| 閲覧条件 | 誰でも読める。ログインを要求しない（プロフィールは告知ページと同じ公開情報） |
| 催し一覧の閲覧条件 | 従来どおり参加者のログイン必須（#21） |
| 表示名 | `users.name` をそのまま出す。プロフィール側で別名は持たない（二重管理を避ける） |
| 肩書き | `headline`（60文字）。屋号やひとことはここに置く |
| 自己紹介 | `bio`（400文字）。プレーンテキストで改行を保持する。HTML は受け付けない |
| 活動エリア | `area`（50文字）。自由入力（「東京都渋谷区」など） |
| 活動ジャンル | 固定リストから3つまで。表記揺れを避けるため自由入力にしない |
| リンク | X・Instagram・Webサイト・LINE。`https` のみ。X は `x.com` / `twitter.com`、Instagram は `instagram.com`、LINE は `lin.ee` / `line.me`。Web サイトはホストを問わない |
| 実績 | 「主催 N回・YYYY年から」。`showStats` がオンのときだけ出す。既定はオフ |
| 実績の数え方 | 未削除・`DRAFT` 以外・今日以前の開催日がある催しの件数。共同主催も1件として数える。最も早い開催日の年を活動開始年とする |
| 未作成・非公開のとき | ページは 404 にせず、名前・モノグラム・「催しを見る」だけを出す。自己紹介・リンク・実績は出さない |
| 404 の条件 | 会員が無い、退会済み（`users.deleted_at`）、催しが0件（未削除の主催イベントが無い） |
| 検索 | `noindex, nofollow`。メール・電話・売上・参加者数などの機微情報は API も画面も返さない |
| 公開範囲 | プロフィールは個人単位。催しごとの公開範囲（`visibility`）とは独立に扱う。`UNLISTED` の催しはプロフィールからも一覧に出さない（#21 の掲載条件に従う） |
| 保存単位 | `organizer_profiles` の1会員1行。初回保存で作り、以後は upsert |
| 編集できる人 | 主催イベントを1件以上持つ会員。ゲスト幹事は会員登録へ、催し0件の会員は 403 `NOT_ORGANIZER` |
| プレビュー | 保存前に、公開ページと同じ部品で見え方を確認できる。非公開のままでも中身を描き、注意書きを添える |

## データ

`prisma/migrations/20261022160000_organizer_profile/migration.sql`

| 列 | 型 | 説明 |
| :---- | :---- | :---- |
| `user_id` | UUID PK | `users.id` への外部キー。`ON DELETE CASCADE` |
| `is_published` | BOOLEAN NOT NULL DEFAULT FALSE | 本文・リンク・実績を出すか |
| `headline` | VARCHAR(60) NULL | 肩書き・ひとこと |
| `bio` | VARCHAR(400) NULL | 自己紹介。改行は `\n` に揃える |
| `area` | VARCHAR(50) NULL | 活動エリア |
| `tags` | TEXT[] NOT NULL DEFAULT '{}' | 活動ジャンル。ASCII の固定値 |
| `x_url` / `instagram_url` / `website_url` / `line_url` | VARCHAR(200) NULL | リンク |
| `show_stats` | BOOLEAN NOT NULL DEFAULT FALSE | 実績の表示可否 |
| `created_at` / `updated_at` | TIMESTAMPTZ | 監査用 |

`users` へは `organizerProfile OrganizerProfile?` の関係を足す。行が無い会員を「未作成」として扱うため、バックフィルは要らない。

ジャンルの値とラベル（`src/modules/organizers/types.ts`）:

| 値 | ラベル |
| :---- | :---- |
| `MUSIC` | 音楽 |
| `FOOD` | 食 |
| `LEARNING` | 学び |
| `SPORTS` | スポーツ |
| `LOCAL` | 地域 |
| `BUSINESS` | ビジネス |
| `OTHER` | その他 |

## 実装方針

### 1. 共通関数

`src/modules/organizers/lib/profile.ts`（DB も Next.js も触らない）

| 関数 | 役割 |
| :---- | :---- |
| `profileLinks(draft)` | 入力から X → Instagram → Webサイト → LINE の順のリンク配列を作る。空は飛ばす |
| `profileUrlProblem(url, hosts, label)` | `https`・ホスト・ユーザー情報の有無を検査し、理由を返す |
| `profileContentFromDraft(draft, stats)` | 編集画面の下書きを公開ページの形へ組み立てる（プレビュー用） |
| `profileStats(events, today)` | 開催済みの件数と最も早い開催日の年。無ければ `null` |
| `profileIsPublished(profile)` | 行が無い・非公開を false に寄せる |
| `normalizeProfileTags(values)` | 固定リストに無い値と重複を落とす |
| `profileBioExcerpt(bio, max)` | メタ情報用に改行を空白へ潰して切る |
| `profileInitial(name)` | モノグラムの1文字 |
| `organizerProfilePath(userId)` / `organizerEventsPath(userId)` | `/organizers/{userId}` と `/organizers/{userId}/events`（`public-page.ts`） |

### 2. 入力の検証

`src/lib/schemas.ts` の `OrganizerProfileSchema`。`.strict()` で知らない項目を弾く。

- 文字列は前後を落とし、空文字は `null` にする。`bio` は `\r\n` を `\n` に揃える。
- `tags` は `PROFILE_TAGS` の enum 配列。最大3つ。重複は落とす。
- URL は `https` のみ。ホストの制限は上表のとおり。ユーザー名・パスワードを含む URL は 400。
- エラーは RFC 7807 の 400 で、`errors[].path` に項目名を返す。

### 3. 読み書き

`src/modules/organizers/lib/profile-store.ts`

- `loadPublicOrganizerProfile(userId)`: 会員・プロフィール・未削除の催しを1回で読み、`profileStats` を噛ませて返す。会員が無い・退会済み・催し0件は `null`（画面は 404）。
- `readOrganizerProfileDraft(userId)`: 行が無ければ既定値。
- `readOrganizerProfileStats(userId)`: 編集画面のプレビュー用。
- `upsertOrganizerProfile(userId, input)`: `userId` を主キーに upsert。
- `assertOrganizerMember(userId)`: 未削除の主催イベントが0件なら 403 `NOT_ORGANIZER`。

### 4. API

| エンドポイント | 認可 | 内容 |
| :---- | :---- | :---- |
| `GET /api/v1/public/organizers/[userId]` | 不要 | 名前とプロフィール。非公開でも 200 で、本文・リンク・実績は空。UUID でない・該当なしは 404 |
| `GET /api/v1/organizer/profile` | 会員＋主催イベント1件以上 | 下書き、実績、`homePath`、`eventsPath` |
| `PUT /api/v1/organizer/profile` | 同左 | 検証して upsert。応答は GET と同じ |

主催イベントの一覧 API（`GET /api/v1/public/organizers/[userId]/events`）は #21 のものを URL ごと移す。

### 5. 画面

**SCR-PUB-14 `/organizers/[userId]`** — `src/app/organizers/[userId]/page.tsx`（サーバー）が DB を直接読み、`OrganizerProfileView`（サーバーでもクライアントでも使える表示部品）を描く。

- `.profile-hero`: モノグラム、`h1` に主催者名、肩書き、活動エリア、ジャンル、リンク。
- 自己紹介は `.profile-bio`（`white-space: pre-wrap`）。
- 実績は `.profile-stats` に「主催 N回」「YYYY年から」。
- 未作成・非公開では「この主催者は、まだプロフィールを公開していません。」だけ。
- 末尾に「催しを見る」で `/organizers/[userId]/events` へ。
- `generateMetadata` で `noindex, nofollow`。

**SCR-PUB-13 `/organizers/[userId]/events`** — #21 の `OrganizerPageView` を移設。冒頭にプロフィールへの戻りを足す。

**SCR-ORG-14 `/organizer/profile`** — `src/app/organizer/profile/page.tsx` → `OrganizerProfileForm`（クライアント）。

- 公開/非公開、肩書き、自己紹介、エリア、ジャンル、4つの URL、実績の表示可否。
- 文字数カウンタと、実績の現在値（「主催 N回・YYYY年から」）を出す。
- 「プレビュー」で `OrganizerProfileView` を `preview` 指定で描く。非公開でも中身を出し、注意書きを添える。
- 401 はログイン案内、403 `REGISTER_REQUIRED` は会員登録への導線、403 `NOT_ORGANIZER` は「催しをつくる」への導線。

### 6. 導線

- `/mypage`（SCR-PUB-03）: 公開状態の節と「プロフィールを編集」「公開ページを開く」。`isOrganizer` が false、または API が 403 のときは出さない。
- `/organizer/events`（SCR-ORG-01）: ヘッダーに「プロフィール」「プロフィールを編集」。「参加者に見えるページ」の節に「催しページを開く」「プレビュー」「URLをコピー」。
- 主催者サブタブ（`OrganizerTabs`）に「プロフィール」を足す。
- 告知ページの主催者名（`EventMetaCard`）は名前だけを `/organizers/[userId]` へのリンクにする（「さんの催しを見る」は外す）。
- 参加者ホームのカードは「主催者のページ」として `/organizers/[userId]` へ送る。

### 7. テスト

- 単体 `tests/unit/organizer-profile.test.ts`（36件）: リンクの順序、URL の検査（http・別ホスト・似たドメイン・ユーザー情報）、実績の数え方（下書き・削除・未来日・今日・複数候補日）、下書きから表示への組み立て、ジャンルの正規化、自己紹介の省略、URL の組み立て、`OrganizerProfileSchema` の上限・URL・厳格さ。
- 結合 `tests/integration/organizer-profile.test.ts`（12件）: 未設定でも名前だけ返す、保存の反映、非公開に戻すと隠す、upsert が1行にまとまる、催し0件・退会・不正 UUID の 404、未ログイン 401、催し0件の会員 403 `NOT_ORGANIZER`、http の URL 400、実績の表示可否、編集画面の応答。`TEST_DATABASE_URL` があるときだけ走る。

### 8. ドキュメント

- `docs/overall_system_requirements_common.md`: ルートツリー、画面一覧（SCR-PUB-14 / SCR-ORG-14）、画面遷移図。
- `docs/front_implementation_spec.md`: ルート表、画面一覧、第14節。
- `docs/backend_api_implementation_spec.md`: エンドポイント一覧、5.12〜5.14。
- `docs/DBschema.md`: `organizer_profiles`。
- `docs/issues/public-organizer-page.md`: URL の移動。

## 受け入れ条件

- [x] `/organizers/[userId]` が誰でも開け、名前とプロフィールが出る（`noindex, nofollow`）
- [x] プロフィール未作成・非公開でも 404 にせず、名前と「催しを見る」だけを出す
- [x] 会員が無い・退会済み・催し0件のときは 404
- [x] `/organizers/[userId]/events` が従来どおり催しを出し、プロフィールから遷移できる
- [x] 告知ページの主催者名からプロフィールへ進める（名前だけがリンク）
- [x] `/organizer/profile` で公開/非公開・肩書き・自己紹介・エリア・ジャンル・リンク・実績を保存できる
- [x] 保存前の内容をプレビューで確認できる
- [x] 主催イベント0件の会員とゲスト幹事は編集画面を使えず、案内が出る
- [x] `/mypage` と `/organizer/events` から編集と公開ページへ進める
- [x] 不正な URL・長すぎる文字・未知のジャンル・知らない項目は 400
- [x] 単体・結合テストと `npm run check` が通る

## スコープ外

- 主催者のフォロー、お気に入り、通知
- プロフィールの画像アップロードとテーマ選択（[organizer-profile-appearance.md](organizer-profile-appearance.md) で実装した）
- 屋号と表示名の分離（`users.name` を唯一の表示名とする）
- プロフィールの変更履歴・公開日時の表示
- 検索エンジンへの露出（`noindex` を維持する）
- 参加者側のプロフィール（参加者名は出欠の回答に閉じる）

## その後の変更

編集画面の冒頭にあった「公開設定」パネル（公開中／非公開の見出しと、プレビュー・公開ページのボタン）を外した。同じことはフォームの「公開」チェックが持っており、見出しだけが二重になっていた。あわせて、フォームの中身を `<section className="card stack">` で囲み、先頭に「公開ページに出る内容」の見出しと補足を置いた。どこから下が公開ページに出る内容かを、枠で示すため。プレビューは `btn--ghost`、公開ページを開くは `btn--outline`（どちらも `--sm`）にして、保存する（`btn--primary`）と同じ行に並べる。主催者の節のラベルは「プロフィール」から「公開プロフ」に変えた。5 つの節を 390px に並べると `OrganizerTabs` の帯が横に流れるので、いちばん長いラベルを 5 文字に縮めた。
