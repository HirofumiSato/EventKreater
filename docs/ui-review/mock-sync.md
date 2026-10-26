# 製品からモックを生成する手順

モック（`style-guide/mock-*.html`）は**製品の DOM を写した生成物**です。手で書きません。
製品が正で、モックはその写しです。比較（parity）はしません。

```text
製品の src を変更 → npm run mock:sync → style-guide/mock-*.html をコミット
                                     ↘ storage/mock-shots/*.png（ローカルのみ）

npm run check → ソースの指紋と manifest を比べる → 違えば「mock:sync を実行してください」で止まる
```

## 前提

デモデータが要ります。初回と、データを作り直したいときだけ実行します。

```powershell
npm run db:seed:ui
```

`storage/ui-demo.json`（トークンと催しの ID）を読みます。このファイルはコミットしません。

## 3 手順

```powershell
# 1. 製品を直す（src/app/**/page.tsx、src/components/ui/**、src/styles/** など）

# 2. モックを撮り直す（既定は本番ビルド。src が変わっていれば 1〜2 分かかる）
npm run mock:sync

# 3. 同期していることを確かめる（ブラウザも DB も使わない。1 秒未満）
npm run check
```

`style-guide/` 以下と `style-guide/assets/` を、`mock:sync` が書き換えたぶんだけコミットします。
PNG（`storage/mock-shots/`）はコミットしません。

## コマンド

| コマンド | 何をするか |
| --- | --- |
| `npm run mock:sync` | 全 33 画面（28 画面 + 状態）。本番ビルドを `.next-ui-prod` に作り、3014 で配って撮る |
| `npm run mock:sync -- --only=20,24` | No. で絞る（1 画面 5 秒前後）。`--only=04-event-member` でも絞れる |
| `npm run mock:sync -- --no-shots` | HTML だけ（PNG を撮らない） |
| `npm run mock:sync -- --dev` | 開発サーバー（3012）で撮る。保存がそのまま出るが、CSS の当たり方が本番とずれることがある |
| `npm run mock:check` | 同期の判定だけ（`npm run check` の中でも走る） |
| `npm run mock:serve` | 生成したモックを `http://127.0.0.1:4321/style-guide/mock-index.html` で配る |

部分同期（`--only`）は `mock-manifest.json` の `uiHash` を進めません。撮っていない画面まで
「同期済み」に見えてしまうためです。**コミットの前は必ず全体を回してください**（部分同期の
あとは `npm run check` が通りません）。

## 端末の幅で見る（`mock-frame.html`）

`style-guide/mock-frame.html` は、モックを iframe に入れて 390 / 1280 を切り替える枠ページです。
`npm run mock:sync` が manifest から作り直します（手で編集しません）。

```text
http://127.0.0.1:4321/style-guide/mock-frame.html?p=mock-create.html&w=390
```

- 上の帯で画面を選ぶ（状態は「04 イベント告知・出欠（満員）」のように括弧で出る）
- `← 前` / `次 →` と ← → キーで、目録の順に送れる
- `スマホ 390` / `PC 1280` で幅を切り替える。iframe の幅がそのまま画面の幅になるので、
  メディアクエリもその幅で効く（窓が狭いときは、はみ出さない倍率まで縮めて表示する）
- `HTML をそのまま開く` で、枠なしのモックを開く
- 一覧（`mock-index.html`）の画面名もこの枠へ入る。行の右端の `390` / `1280` / `HTML` で直接開ける

枠ページと一覧は、`mock:sync` のたびに存在を確認します（消えていれば `npm run check` が止めます）。

## 生成物

| 置き場所 | コミット | 中身 |
| --- | --- | --- |
| `style-guide/mock-*.html` | する | 画面 1 枚 = 1 ファイル。状態つきは `mock-event-member.html` のように接尾辞が付く |
| `style-guide/assets/*` | する | 製品の CSS と画像。内容のハッシュが名前（同じ内容なら増えない） |
| `style-guide/mock-manifest.json` | する | 画面の一覧、各 HTML の指紋、UI ソースの指紋（`uiHash`） |
| `style-guide/mock-index.html` | する | モックの一覧ページ（生成物） |
| `style-guide/mock-frame.html` | する | 幅を選んで見る枠ページ（生成物。iframe で 390 / 1280） |
| `storage/mock-shots/*.png` | しない | 390 / 1280 の撮影と `index.html`。目視用 |

`style-guide/index.html` と `style-guide.css` は**部品見本**で、同期の対象外です。

## HTML をどう整えているか

`scripts/lib/mock-html.mjs`（ブラウザを知らない純ロジック）が担当します。

- `<script>`・HTML コメント・`nonce`・`data-nextjs-*`・`<next-route-announcer>` を落とす
- `<link rel="stylesheet" href="/_next/…">` の CSS を取得して `style-guide/assets/<hash>.css` に保存し、
  リンクを差し替える（Tailwind の preflight まで含めて製品と同じ見た目にするため）
- 同一オリジンの画像（`/samples/…`、`/api/v1/flyer-assets/…`、`/_next/image?…`）を取得して
  `style-guide/assets/<hash>.<ext>` に保存し、`src` と `srcset` を差し替える。`data:` はそのまま
- 内部リンクは、目録（`scripts/lib/mock-screens.mjs`）のパスに一致すればそのモックへ、それ以外は `#` へ
- 先頭に「生成物。`npm run mock:sync` で作り直す。手で編集しない」のコメントを入れる
- 中身が同じなら書き換えない（2 回続けて実行しても差分が出ない）

撮れなかった素材は元の URL のまま残し、その画面の行に「素材 N 件は元の URL のまま」と出ます。

## 画面ごとの例外

- **13 メールアドレスの確定**（`/account/email/verify`）は、開いた時点で確認トークンを消費します。
  `mock:sync` は撮る前に `storage/ui-demo.json` の `emailChangeTokens` と `emailChangeTargets` で
  同じトークンを発行し直すので、何度実行しても同じ画面になります。
- **22 イベントの編集**（`/organizer/events/<id>/edit`）は、開いた時点で排他ロックを取ります。
  `mock:sync` は開く前にロックを消し、撮り終えたら返します。直列に 1 画面ずつ開きます。

## 同期漏れを止める仕組み

`npm run check` の `mock-sync` が `scripts/check-mock-sync.mjs` を呼びます。見るのは 3 つです。

1. 画面の見た目を決めるソースの指紋（`uiHash`）が、最後に `mock:sync` したときと同じか
2. 目録にある画面の HTML がそろっているか
3. 書き出した HTML が manifest の指紋のままか（手で直していないか）

加えて、一覧（`mock-index.html`）と枠（`mock-frame.html`）が実在するかも見ます。

`uiHash` の対象は次のとおりです（`scripts/lib/mock-hash.mjs`）。

- `src/app/**`（`.tsx` / `.css`）
- `src/components/**`（`.tsx` / `.ts` / `.css`）
- `src/styles/**`（`.css`）
- `src/modules/*/components/**`（`.tsx` / `.ts` / `.css`）
- `src/lib/format.ts` / `src/lib/site.ts` / `tailwind.config.*` / `postcss.config.*`

API や `src/modules/*/lib/**` は含めません（DOM を作らないため）。迷ったら足してください。

指紋は改行コードを LF にそろえてから計算します。Windows の作業ツリーには CRLF のファイルが
混ざることがあり、そのままでは「手元では通るのに CI だけ落ちる」になるためです。

どうしても同期せずに通す必要があるときだけ、`MOCK_SYNC_ALLOW_STALE=1` を付けます。
使ったときは PR に理由を書いてください。CI では通りません（環境変数を渡していないため）。

## うまくいかないとき

| 症状 | 見るところ |
| --- | --- |
| `storage/ui-demo.json が読めません` | `npm run db:seed:ui` |
| `本番ビルドに失敗しました` | `node_modules/.cache/ui-harness/next-build.log` |
| `next start が終了しました` | `node_modules/.cache/ui-harness/next-start.log` |
| 画面が「他の人が編集中」になる | `mock:sync` がロックを消せていない。`npm run mock:sync -- --only=21` で撮り直す |
| 1 画面だけ `NG` と出る | その画面の API かデモデータ。`manifest` は前回のままなので、直してから全体を回す |
| CSS が当たらない（`--dev`） | 本番ビルドで撮り直す（`--dev` は開発サーバーの都合で CSS が `<link>` にならないことがある） |
| 枠ページが「画面」だけになる | `mock-frame.html` が古い。`npm run mock:sync` で作り直す |

## 画面を足すとき

1. `scripts/lib/mock-screens.mjs` の `buildScreens` に 1 行足す（`no` / `slug` / `name` / `group` / `path` / `auth` / `note`）
2. `npm run db:seed:ui`（その画面が見るデータを足した場合）
3. `npm run mock:sync` → `style-guide/mock-*.html` と `mock-index.html` が増える
4. `npm run check` が通ることを確かめる（目録と manifest の突き合わせはここで行う）
