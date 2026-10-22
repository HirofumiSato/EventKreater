# イベントのオーナー（筆頭幹事）と共同主催者を、表示とデータで分ける

> GitHub Issue の下書き。`gh` 未導入の環境のため、このファイルを本文として起票する。
> タイトル案: イベントのオーナー（筆頭幹事）と共同主催者を、表示とデータで分ける

## 背景

`event_organizers` は `OWNER`（筆頭幹事）と `CO_HOST`（共同幹事）を持っているが、画面と API はその区別をほとんど使っていない。複数の主催者がいるイベントで、参加者にも管理者にも「誰がオーナーか」が分からない。また、ゲスト幹事には表示名がなく、DB 上も「1イベント1オーナー」が保証されていない。

あわせて、ホーム（`/`）の機能紹介は告知・出欠・集計・売上の4つしかなく、共同主催という価値が伝わっていない。`/service` には「幹事を分けられる」があるが、ホームには無い。

## 現状と根拠

### データ

- `EventOrganizer` は `role` を持つが、表示名の列がない（`prisma/schema.prisma:613-627`）。ゲスト幹事は `guestTokenHash` だけで、公開できる名前を持たない。
- 一意制約は `@@unique([eventId, userId])` のみ（`prisma/schema.prisma:624`）。`userId` が NULL のゲスト行には効かないため、複数 `OWNER` やオーナー不在を防げない。要件は「OWNER は単一」（`docs/archive/event-page/specs/event_page_data_model_and_crud.md:235`）。
- 未登録でも共同主催を受諾できる（`src/modules/organizers/lib/invitations.ts:95-99`）。UC-10 はログイン・登録を経て受諾する前提（`docs/overall_system_requirements_common.md:413-422`）で、食い違っている。
- 会員登録時の引き継ぎで、同一イベントに会員行があるとゲスト行を削除する（`src/modules/auth/lib/hydrate.ts:46-52`）。ゲスト行が `OWNER`、会員行が `CO_HOST` だと、削除後にオーナーが不在になる。
- 退会時は `OWNER` のイベントを論理削除し、`CO_HOST` 行を削除する（`src/modules/account/lib/account.ts:333-338`）。オーナー譲渡の手段はない。
- `EventOrganizer.user` は `onDelete: Cascade`（`prisma/schema.prisma:622`）で、会員行の物理削除でもオーナーが消え得る。

### 表示

- 公開告知ページは主催者情報を返していない（`src/app/api/v1/public/events/[id]/route.ts:126-151`、`EventPageClient.tsx`、`EventMetaCard.tsx`）。要件のワイヤーフレームにはヘッダーの「主催者名」がある（`docs/archive/event-page/specs/event_page_system_requirements.md:292`）が未実装。
- 主催一覧は閲覧者自身のロールしか出さない（`src/modules/events/components/EventCard.tsx:23`、`src/lib/serializers.ts:425`）。イベントのオーナー名は分からない。
- 管理コンソールは `role = OWNER` の1行だけを出し（`src/modules/admin/lib/directory.ts:139-152`）、ゲストは「ゲスト幹事」と表示する（`src/app/console/events/page.tsx:172`）。共同主催の内訳は見えない。
- 共同主催の一覧・解除の API と UI がない。招待は `POST .../invitations` だけで、受諾時に `isRevoked` にする一方通行（`src/modules/organizers/lib/invitations.ts:100-103`）。
- 売上画面は、自分がオーナーのイベントと共同主催のイベントを区別せず合算する（`src/app/api/v1/organizer/revenue/route.ts:64-115`）。
- ホームは4項目だけで、`/service` の「幹事を分けられる」に相当する紹介がない（`src/app/page.tsx:16-35`、`src/app/service/page.tsx:10-16`）。

### 権限

- 招待・削除は `OWNER`、編集・名簿・領収書は全幹事（`src/modules/auth/lib/guards.ts:140-191`、`src/app/api/v1/organizer/events/[id]/route.ts:130`）。
- 複製は全幹事ができる（`src/app/api/v1/organizer/events/[id]/clone/route.ts:20-27`）。仕様の「共同幹事は複製権限を制限」（`docs/archive/event-page/specs/event_page_data_model_and_crud.md:613`）と食い違う。
- 領収書の発行者は「発行した幹事」の名前になる（`src/app/api/v1/organizer/events/[id]/participants/[participantId]/receipt/route.ts:66-73`）。オーナー固定かは未定義。

## 今回の決定

| 論点 | 決定 |
| :---- | :---- |
| 公開告知ページの表示 | オーナーと共同主催者を分けて全員表示する。名前だけを出し、メール・ID は返さない |
| 表示名の持ち方 | 会員は `User.name` を都度参照する。ゲスト幹事用に `EventOrganizer.displayName` を追加する |
| オーナーの一意性 | 部分ユニーク索引で「1イベント1オーナー」を保証する。譲渡・オーナー自身の脱退は別 issue |
| 共同主催の管理 | 主催者画面に一覧・招待・解除をまとめて追加する |
| 未登録の共同主催 | 共同主催は会員のみ。未登録の受諾を廃止する。既存のゲスト共同主催行は壊さず残す |
| ホームの紹介 | 5項目目として「幹事が何人いても、誰の催しか分かる」を追加し、見出しを「5つ」に更新する |

補足として、公開ページの表示場所は `EventMetaCard` の基本情報に「主催」「共同主催」の行を足す。ワイヤーフレームのヘッダー表記はこの行に読み替え、要件文書を更新する。

## ゴール

1. 公開告知ページで、イベントのオーナーと共同主催者を区別して表示する。
2. 主催一覧・管理コンソール・売上で、イベントのオーナーと自分の立場を混同しない。
3. データ上、1イベント1オーナーを保証し、ゲスト行と会員行の重複でオーナーが消えないようにする。
4. 主催者名の取得元を1か所にまとめ、公開ページ・一覧・管理コンソールで同じ名前を出す。
5. 要件文書と実装が食い違う点（未登録の共同主催）を解消する。
6. ホームで共同主催の価値を伝え、初見の幹事が「自分のためのサービスだ」と理解できるようにする。

## スコープ外

- オーナー譲渡、オーナー自身の脱退、オーナー退会時のイベント継承（別 issue。今回は「オーナーは1人」の保証まで）
- 主催者のプロフィール（画像・自己紹介・連絡先）
- 共同主催の追加・解除の通知メール
- 領収書の発行者をオーナーに固定する変更（現状どおり「発行した幹事」）
- 複製権限の見直し（仕様との食い違いは本 issue に記録し、判断は別 issue）
- 主催人数の上限
- 売上の按分（`docs/issues/cohost-revenue-allocation.md`）

## 実装方針

### 1. スキーマと移行

`EventOrganizer` に表示名を追加する。

```prisma
model EventOrganizer {
  /// ゲスト幹事の公開表示名。会員は User.name を使うため NULL。
  displayName String? @map("display_name") @db.VarChar(50)
  /// 1イベント1オーナーは部分ユニーク索引で保証する（Prisma では表現できないため migration の生SQLで作る）。
}
```

移行の順序は次のとおり。

1. 既存データの修復
   - 複数 `OWNER` があるイベントは、`created_at` が最も早い行だけ `OWNER` にし、残りを `CO_HOST` へ下げる。
   - `OWNER` が無いイベントは、`created_at` が最も早い幹事行を `OWNER` へ上げる。
2. 修復後に部分ユニーク索引を作る。

```sql
CREATE UNIQUE INDEX "event_organizers_one_owner"
  ON "event_organizers" ("event_id")
  WHERE "role" = 'OWNER';
```

3. 修復結果を検証するクエリを migration 手順に残す（`OWNER` が 0 人・2人以上のイベントが 0 件であること）。

`displayName` のバックフィルはしない。既存のゲスト行は NULL のまま、表示は役割名だけにする。

### 2. 書き込みと認可

- 共同主催の受諾を会員のみにする（`src/modules/organizers/lib/invitations.ts`）。
  - `identity.userId` が無い場合は 403 `REGISTER_REQUIRED`（`probs/register-required`、`error: "REGISTER_REQUIRED"`、文言は「共同主催への参加には会員登録が必要です。」）。
  - ゲスト用 `guestOrganizerToken` の発行と Cookie 書き込み（`src/app/api/v1/invitations/[code]/route.ts:22-37`）を削除する。
- `src/app/invitations/[code]/page.tsx` は、未ログインなら受諾ボタンを出さず、`/auth/register?next=/invitations/<code>` へ送る。プレビュー API に `loggedIn` を足すか、画面で `/api/v1/user/profile` を見て出し分ける。POST 側の 403 は最後の砦として残す。
- ゲスト作成時の表示名（`src/app/organizer/events/new/page.tsx`、`src/app/api/v1/public/events/route.ts`、`src/modules/events/lib/events.ts`）。
  - 作成フォームに任意の「主催者名（公開されます）」を足す。未ログインのときだけ表示し、50文字まで。
  - 作成 API の入力に `organizerDisplayName` を足し、ゲストの `OWNER` 行にだけ保存する。会員のときは無視する（`User.name` を使う）。
- `hydrate` の修正（`src/modules/auth/lib/hydrate.ts:46-52`）。
  - 会員行が既にある場合、ゲスト行が `OWNER` で会員行が `CO_HOST` なら、会員行を削除してからゲスト行を会員へ付け替え、`OWNER` を保つ。
  - それ以外は現状どおりゲスト行を削除する。
  - 付け替え後に `OWNER` が 0 人になるケースをテストで固定する。
- 共同主催の解除 API を追加する。
  - `DELETE /api/v1/organizer/events/[id]/organizers/[organizerId]`
  - 認可は `assertRegisteredOwner`。`OWNER` 行は削除不可（409 `OWNER_NOT_REMOVABLE`）。他イベントの ID は 404。
  - 解除する行が `EventLock` を保持している場合は、同じトランザクションでロックも削除する。保持したまま権限を外すと、解放も引き継ぎもできず詰まるため。
- 招待の発行は現状の `assertRegisteredOwner` のまま（`src/app/api/v1/organizer/events/[id]/invitations/route.ts:14`）。

### 3. 名前の解決を1か所にまとめる

`src/modules/organizers/lib/names.ts` を追加し、`organizerDisplayName` を共通化する。

- `user.name` があればそれを使う。
- 無ければ `displayName` を使う。
- どちらも無ければ `null` を返し、画面は「主催者」「共同主催」とだけ出す。

公開 API・主催一覧・管理コンソール・詳細 API は、この関数を通した値だけを返す。

### 4. API

- 公開 API（`GET /api/v1/public/events/[id]`）に `organizers` を追加する。

```json
"organizers": {
  "owner": { "name": "佐藤 博文" },
  "coHosts": [{ "name": "田中" }]
}
```

  - 並びは `createdAt` 昇順。`owner` が不在の旧データでは `null`。
  - メール、ユーザー ID、主催者行 ID は返さない。
- 主催一覧（`GET /api/v1/organizer/events`）のレスポンスに `ownerName` を追加する（`src/lib/serializers.ts:425` の `serializeOrganizerListItem`）。`role` は現状どおり閲覧者の立場。
- イベント詳細（`GET /api/v1/organizer/events/[id]`）に `organizers`（`id` / `name` / `isGuest` / `role`）を追加する。共同主催パネルはこれを使う。
- `GET /api/v1/organizer/events/[id]/organizers` を追加する。幹事なら閲覧可、メールは返さない。
- 管理コンソール（`src/modules/admin/lib/directory.ts`）で、オーナー名に加えて共同主催の人数と名前を返す。ゲストオーナーは `displayName` を出し、無ければ「ゲスト幹事」のまま。
- 売上 API（`src/app/api/v1/organizer/revenue/route.ts`）のイベント別行に、閲覧者の `role` を追加する。

### 5. 画面

- `EventMetaCard` に「主催」「共同主催」の行を足す。共同主催が 0 人なら行を出さない。名前が無い場合はラベルだけ出す。
- `EventCard` にオーナー名を出し、自分の立場（筆頭幹事 / 共同幹事）は現状のバッジを維持する。共同主催のときに「あなたは共同主催」と分かる表記にする。
- 編集画面（`src/app/organizer/events/[id]/edit/page.tsx`）に、`OWNER` だけ表示する共同主催パネルを追加する。
  - 一覧（オーナー / 共同主催、ゲストかどうか）
  - 招待（既存の `InviteOrganizerButton` をパネル内へ移す）
  - 解除（確認ダイアログ。実行後は一覧を更新）
- 共同主催受諾画面は、未ログイン時に登録・ログイン導線を主操作にする。
- 主催一覧・売上・管理コンソールで、オーナーと共同主催の区別が読み取れる表記にする。

### 6. ホームの機能紹介

`src/app/page.tsx` の `capabilities` に5項目目を追加し、見出しと補足を更新する。文言は機能名ではなく便益で書く（既存コメントの方針）。

```tsx
// src/app/page.tsx
const capabilities = [
  // ... 既存4項目 ...
  [
    "幹事が何人いても、誰の催しか分かる",
    "主催者と共同主催者を分けて、告知ページに名前を出します。招待できるのは会員の幹事で、利用枠を消費するのはイベントを公開した主催者だけです。",
  ],
];
```

見出しと補足も件数に合わせる（`src/app/page.tsx:81-82`）。

```tsx
<h2 className="section__title">幹事の手間を、5つに減らす</h2>
<p className="section__note">告知・出欠・集計・お金・運営を、1つのURLにまとめます。</p>
```

`/service` の既存文言も、新しい用語（主催者／共同主催者）に揃える（`src/app/service/page.tsx:15`）。

```tsx
["主催者と共同主催", "主催者と共同主催者を分けて、告知ページに名前を出します。招待された共同主催者は編集と名簿を分担でき、利用枠を消費するのはイベントを公開した主催者だけです。"],
```

- `.feature-list` は縦積みのリストで、列数を固定していない（`src/app/attendance.css:498-511`、`645-658`）。5件になっても4列グリッドのような崩れは起きない。
- ホームの主操作は「無料でイベントを作る」1本のまま。CTA と画像は増やさない（`docs/front_implementation_spec.md:287` の方針）。
- 会員限定の機能（共同主催の招待）を含むため、紹介文に「招待できるのは会員の幹事」と1文だけ添える。

### 7. ドキュメント

- `docs/DBschema.md`: `event_organizers.display_name` と部分ユニーク索引を追記。
- `docs/archive/event-page/specs/event_page_data_model_and_crud.md`: OWNER 単一の保証方法、表示名の取得元、共同主催は会員のみを追記。
- `docs/archive/event-page/specs/event_page_system_requirements.md`: ワイヤーフレームのヘッダー「主催者名」を、基本情報の「主催 / 共同主催」行に読み替える。
- `docs/overall_system_requirements_common.md`: UC-10 の受諾を会員必須に合わせる。共同主催一覧・解除の操作を追記。
- `docs/front_implementation_spec.md`: 編集画面の共同主催パネル、公開ページの主催表示、ホームの5項目（第287行の「4つ」を「5つ」に直す）を追記。

## 受け入れ条件

### データ

- [ ] `event_organizers.display_name` が追加され、ゲストの `OWNER` 行にだけ保存される
- [ ] 部分ユニーク索引により、1イベントに `OWNER` を2行作れない
- [ ] 既存の複数 `OWNER` は最も早い1行だけ残り、`OWNER` 不在のイベントは最も早い幹事行が `OWNER` になる
- [ ] 会員の表示名は `User.name` を参照し、改名が公開ページに反映される
- [ ] ゲスト `OWNER` の表示名が空でも、公開ページが壊れず「主催者」と表示される
- [ ] ゲスト `OWNER` の行を会員へ付け替えるとき、会員行が `CO_HOST` でも `OWNER` が失われない
- [ ] 未登録での共同主催受諾は 403 `REGISTER_REQUIRED` になる
- [ ] 既存のゲスト共同主催行は削除されず、表示は「共同主催」になる

### API

- [ ] 公開 API が `organizers.owner` と `organizers.coHosts` を返す
- [ ] 公開 API のレスポンスにメール、ユーザー ID、主催者行 ID が含まれない
- [ ] 主催一覧 API が `ownerName` と閲覧者の `role` を返す
- [ ] 詳細 API と共同主催一覧 API が、オーナーと共同主催を区別して返す
- [ ] 解除 API は登録済み `OWNER` のみ実行でき、共同主催からは 403
- [ ] `OWNER` 行は解除できず 409 `OWNER_NOT_REMOVABLE`
- [ ] 解除された共同主催が `EventLock` を保持していた場合、ロックも解放される
- [ ] 解除された共同主催は、名簿・領収書・編集・売上へアクセスできない
- [ ] 管理コンソールでオーナーと共同主催を区別して確認できる
- [ ] 売上画面のイベント別行に、自分の立場（`OWNER` / `CO_HOST`）が出る

### UI

- [ ] 公開告知ページに「主催」と「共同主催」が分かれて表示される
- [ ] 共同主催が 0 人のとき「共同主催」の行が出ない
- [ ] 幅 375px / 768px / 1280px で主催者名が折り返して崩れない
- [ ] 主催一覧カードにオーナー名と自分の立場が出る
- [ ] 編集画面の共同主催パネルが `OWNER` にだけ表示され、一覧・招待・解除ができる
- [ ] 共同主催には共同主催パネルも解除操作も表示されない
- [ ] 未ログインで招待 URL を開くと、受諾ではなく登録・ログイン導線が出る
- [ ] ゲスト作成画面に「主催者名（公開されます）」があり、会員には表示されない

### ホーム

- [ ] ホームに5項目目が表示され、見出しの「5つ」と件数が一致する
- [ ] 補足が「告知・出欠・集計・お金・運営」になっている
- [ ] 375px / 768px / 1280px で `feature-row` が崩れない
- [ ] CTA が増えていない（主操作は「無料でイベントを作る」のまま）
- [ ] `/service` の「できること」も同じ用語（主催者／共同主催者）になっている
- [ ] 会員限定の招待であることが1文で分かる

### テスト

- [ ] `tests/integration/organizers.test.ts` に、表示名の解決、公開 API の形、会員のみ受諾、解除の認可、ロック解放を追加
- [ ] `tests/integration/hydrate.test.ts` に、ゲスト `OWNER` ＋会員 `CO_HOST` の付け替えを追加
- [ ] 部分ユニーク索引の違反と、移行後のオーナー一意性を確認するテストを追加

## 参考

- `prisma/schema.prisma` — `EventOrganizer`, `OrganizerRole`
- `src/modules/organizers/lib/invitations.ts` — 招待の発行・受諾
- `src/modules/auth/lib/hydrate.ts` — ゲスト幹事の付け替え
- `src/modules/auth/lib/guards.ts` — `assertOwner`, `assertRegisteredOwner`
- `src/app/api/v1/public/events/[id]/route.ts` — 公開情報
- `src/lib/serializers.ts` — `serializeOrganizerListItem`
- `src/modules/admin/lib/directory.ts` — 管理コンソールのイベント検索
- `src/app/api/v1/organizer/revenue/route.ts` — 横断の売上集計
- `src/app/page.tsx` / `src/app/service/page.tsx` — ホームとサービス紹介
- `docs/archive/event-page/specs/event_page_data_model_and_crud.md` — OWNER 単一の記述
- `docs/overall_system_requirements_common.md` — UC-10
