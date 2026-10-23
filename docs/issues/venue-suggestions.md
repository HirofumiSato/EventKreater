# 開催場所は過去に入力した会場から選べるようにする

## 背景

新規イベント作成（SCR-ORG-02）と編集（SCR-ORG-05）の「開催場所」は、会場名・郵便番号・都道府県・市区町村・町域・番地・建物名の 7 項目を毎回入力する。同じ会場で何度もイベントを開く主催者ほど、同じ住所を打ち直している。郵便番号からの入力補助（`PostalCodeField`）はあるが、**過去に入力した会場をそのまま選ぶ手段が無い**。

チラシには「過去のチラシから選ぶ」（`FlyerSelectModal` + `GET /api/v1/flyer-assets`）があり、会員と端末の両方から過去の成果物を引ける。会場にも同じ形の導線を用意する。

## 現状と根拠

- 住所は `Event` の `venueName` / `postalCode` / `prefecture` / `city` / `town` / `addressLine` / `building` に分かれて保存される。会場専用のテーブルは無い。
- 過去のチラシは `FlyerAsset` の `userId` と `ownerTokenHash` を OR で絞り、端末 Cookie `flyer_owner` で未登録の幹事も拾う（`src/modules/flyers/lib/ownership.ts`）。
- イベントの幹事は `EventOrganizer.userId` / `guestTokenHash` で分かれるが、`guestTokenHash` はイベントごとの Cookie（`org_token_<eventId>`）なので、**イベントをまたいだ同一端末の判定には使えない**。
- チラシ選択モーダルは開いたときに一覧を取得し、空状態・エラー・削除をその場で扱う。会場の候補も同じ操作感に揃える。

## 今回の決定

| 論点 | 決定 |
| :--- | :--- |
| 候補の範囲 | ログイン中の自分の過去イベント ＋ この端末で作ったイベント。他人の会場は出さない |
| 候補の単位 | 会場ひとまとまり（会場名＋郵便番号＋都道府県〜建物名）を 1 件として選ぶ |
| UI | 会場名の下の「過去の会場から選ぶ」ボタン＋モーダル（チラシ選択と同じ形） |
| 追加のタイミング | イベントの作成・下書き保存・公開・編集保存の成功時に自動で追加 |
| 削除 | 候補ごとに削除できる。物理削除 |
| 重複 | 正規化した住所の指紋（sha256）で 1 行にまとめ、最後に使った日時だけ更新 |
| 表示件数 | 最後に使った日時の新しい順に最大 20 件。DB 側の上限は設けない |

## 実装

### 1. 保存先

`venue_suggestions` を追加した（`prisma/migrations/20261023120000_venue_suggestions`）。

| 列 | 役割 |
| :--- | :--- |
| `owner_key` | `u:<userId>` または `d:<Cookie venue_owner の値の sha256>` |
| `fingerprint` | 会場名〜建物名を正規化した sha256。`(owner_key, fingerprint)` で一意 |
| 住所 7 列 | `Event` と同じ桁数。会場名だけの候補も持てる |
| `last_used_at` | 並び順。再入力のたびに更新する |

`userId` と `ownerTokenHash` の 2 列に分けなかったのは、PostgreSQL の一意制約が NULL 同士を別物として扱い、`userId` が NULL の行が同じ会場でも重複して入るためである。1 列に寄せると `(owner_key, fingerprint)` が素直に効き、取得も `owner_key IN (...)` の 1 条件で済む。

### 2. 所有者の決め方

`src/modules/events/lib/venue-suggestions.ts`。

- 読み取りは `venueOwnerKeys(req)` が `resolveOptionalUserId` と Cookie `venue_owner` から最大 2 つの key を返す。セッションが切れていても候補は開けるよう、未ログインとして端末の key に寄せる。
- 記録は `rememberVenue(req, address)`。未登録の幹事には `venue_owner`（180 日、httpOnly・SameSite=Lax）を新しく払い出す。会員でも Cookie が残っていれば端末側の候補も更新し、会員登録後に未登録時代の会場が消えないようにする。
- 端末トークンは本文やヘッダでは受け取らず、サーバーが発行した Cookie からのみ導出する。他人の候補を指定する経路を作らない。
- 記録の失敗は `rememberVenueQuietly` が握りつぶす。候補は入力支援でしかないので、イベントの作成・保存を失敗させない。

### 3. API

| メソッド | パス | 内容 |
| :--- | :--- | :--- |
| GET | `/api/v1/venues` | 自分の候補を新しい順に最大 20 件。会員と端末で同じ会場は 1 件にまとめる |
| DELETE | `/api/v1/venues/[id]` | 自分の候補だけを物理削除。UUID でない・無い・他人の候補は 404 |

記録は `POST /api/v1/public/events`、`POST .../draft`、`POST .../publish`、`PUT /api/v1/organizer/events/[id]` の成功時に呼ぶ。公開 API は下書き・即公開の両方を通る。

### 4. 画面

`src/modules/events/components/VenueSelectModal.tsx` を追加し、`LocationSection` の会場名の下にボタンを置いた。選ぶと 7 項目を 1 回の `onChange` でまとめて反映して閉じる。旧・自由入力の `location` は残す（構造化住所があるときは送信で使われない）。`LocationSection` は作成と編集で共有しているため、編集画面にも同じボタンが出る。

## テスト

- `tests/unit/venue-suggestions.test.ts` — 指紋の正規化（ハイフン・空白・建物名）、会員と端末の ownerKey、記録（Cookie の発行、会員は自分のみ、端末分の併用、失敗しても止めない）、一覧の重複除去と上限、削除の絞り込み。
- `tests/integration/venue-suggestions.test.ts`（`TEST_DATABASE_URL` があるときだけ）— 端末の候補を覚えて次回選べる。同じ会場は行が増えず `lastUsedAt` だけ進む。会員の候補は本人にだけ見え、他人は削除できない。

## 受け入れ条件

- [x] 作成画面の「開催場所」に「過去の会場から選ぶ」がある
- [x] 過去に保存・公開したイベントの会場が候補に出る
- [x] 選ぶと会場名・郵便番号・住所 5 項目がまとめて入る
- [x] 候補は会場名と住所、最後に使った日時、郵便番号が見える
- [x] 同じ会場を何度使っても候補は 1 件のまま
- [x] 候補ごとに削除でき、その場で一覧から消える
- [x] 未登録のまま作ったイベントの会場も、同じ端末なら候補に出る
- [x] 他人の会場は候補に出ない
- [x] 候補が空のときは、保存すると次回から出ることを案内する
- [x] 候補の取得に失敗しても、住所の手入力は続けられる

## スコープ外

- ゲスト幹事が会員登録したときの候補の引き継ぎ（`venue_owner` が残る間は端末の候補として見え続ける）。
- 候補の編集（会場名だけ直したいときは、そのまま入力して保存すれば新しい指紋の候補になる）。
- 住所の入力中のインクリメンタル検索。今回はモーダルから選ぶ。
- 削除の確認ダイアログ。誤って消しても、その会場で保存し直せば戻る。
- 全ユーザー共有の会場カタログ。

## セキュリティ上の判断

- `owner_key` はセッションとサーバー発行 Cookie からだけ導出する。`x-organizer-token` のようなクライアント指定値は使わない。
- `venue_owner` は httpOnly・SameSite=Lax。HTTPS では `Secure`（`writeCookie` の共通処理）。
- 削除は `owner_key IN (...)` を条件にした `deleteMany` で行い、他人の候補の存在を 404 でしか返さない。
- 候補に保存するのは会場名と住所だけで、イベント名・参加者・連絡先は持たない。

## 参考

- `src/modules/events/lib/venue-suggestions.ts` — 指紋・ownerKey・記録・一覧・削除
- `src/app/api/v1/venues/route.ts` — 候補の一覧
- `src/app/api/v1/venues/[id]/route.ts` — 候補の削除
- `src/modules/events/components/VenueSelectModal.tsx` — 選択モーダル
- `src/modules/events/components/EventFormSections.tsx` — 開催場所の入力欄
- `prisma/schema.prisma` — `VenueSuggestion`
- `docs/backend_api_implementation_spec.md` — 5.15
- `docs/front_implementation_spec.md` — 12.3
