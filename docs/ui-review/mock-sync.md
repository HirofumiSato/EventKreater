# 製品からモックを生成する手順

モック（`style-guide/mock-*.html`）は**製品の DOM を写した生成物**です。手で書きません。
製品が正で、モックはその写しです。比較（parity）はしません。

```text
製品の src を変更 → npm run mock:sync → style-guide/mock-*.html をコミット
                                     ↘ storage/mock-shots/*.png（ローカルのみ）
                                     ↘ storage/mock-variants/*.json（隠し DOM の控え。ローカルのみ）

npm run check → ソースの指紋と manifest を比べる → 違えば「mock:sync を実行してください」で止まる
```

## 前提

デモデータが要ります。初回と、データを作り直したいときだけ実行します。

```powershell
npm run db:seed:ui
```

`storage/ui-demo.json`（トークンと催しの ID）を読みます。このファイルはコミットしません。

## 404 の写しを残さない

`storage/ui-demo.json` の ID が DB とずれると、主催者・催しの画面は 404 になります。そのまま撮ると
モックに「見つかりません」の絵が残り、画面の確認ができないまま `npm run check` も通ります
（`check` が見るのはソースの指紋だけのため）。`mock:sync` は撮る前に 2 段で止めます。

| いつ | 何を見るか | 止まったとき |
| --- | --- | --- |
| 撮る前 | `ui-demo.json` の `events.*` / `organizerId` / `coHostId` / `participantId` が DB にあるか（ビルドもブラウザも使わない） | `storage/ui-demo.json の ID が DB にありません（…）` |
| 1 画面ごと | その画面の 4xx / 5xx（`ui-browser` が期待どおりの 4xx を除いた残り）と `document.title` | `NG 04 mock-event.html  「見つかりません」の画面でした（…）` |

どちらも `npm run db:seed:ui` でデモデータを作り直し、`npm run mock:sync` をやり直せば解消します。
止まった回は `mock-manifest.json` を書き換えないので、モックは前回のまま残ります（壊れた写しで
上書きされません）。

判定そのものは `scripts/lib/mock-found.mjs`（ブラウザも DB も知らない）にあり、`tests/unit/mock-sync.test.mjs`
が題名・応答・別ホストの扱いを固定しています。

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
| `npm run mock:sync` | 全 48 画面（31 画面 + 状態）。本番ビルドを `.next-ui-prod` に作り、3014 で配って撮る |
| `npm run mock:sync -- --only=20,24` | No. で絞る（1 画面 5 秒前後）。`--only=04-event-member` でも絞れる |
| `npm run mock:sync -- --no-shots` | HTML だけ（PNG を撮らない） |
| `npm run mock:sync -- --refresh` | 控え（断片・CSS・PNG）を使わず、全画面を取り直す（下の「控え」を参照） |
| `npm run mock:sync -- --dev` | 開発サーバー（3012）で撮る。保存がそのまま出るが、CSS の当たり方が本番とずれることがある |
| `npm run mock:check` | 同期の判定だけ（`npm run check` の中でも走る） |
| `npm run mock:serve` | 生成したモックを `http://127.0.0.1:4321/style-guide/mock-index.html` で配る |

部分同期（`--only`）は `mock-manifest.json` の `uiHash` を進めません。撮っていない画面まで
「同期済み」に見えてしまうためです。**コミットの前は必ず全体を回してください**（部分同期の
あとは `npm run check` が通りません）。

## モックだけが持つもの

モックは製品の写しですが、**製品に存在しない**ものが 4 つだけあります。どれも `npm run mock:sync` が
毎回書き出すので、撮り直しても消えません。手で `mock-*.html` を直さないでください。

| もの | どこが作るか | 何のために |
| --- | --- | --- |
| 左下の付箋（開くと「← 画面一覧 / スマホ / PC / HTML / 画面名 / 実装パス」） | `scripts/lib/mock-html.mjs` の `withMockShell` が各 HTML に script を 1 行足し、`style-guide/mock-shell.js` が組み立てる | モック同士を行き来する。既定は閉じていて、付箋を押すと上へ開く。製品には無い |
| 操作の script（`mock-interactions.js`） | `withMockInteractions` が付箋の script の直後に 1 行足す。中身は `style-guide/mock-interactions.js`（**手で保守する**） | ヘッダーの開閉、日付の選択、ステップの開閉、音声入力、一覧の絞り込み、コピーと遷移。製品は API を呼ぶので、押した結果だけを再現する |
| 画面の一覧（`mock-index.html`） | `scripts/lib/mock-index.mjs` の `indexHtml` | 48 画面の入口。製品には無い |
| 幅の枠（`mock-frame.html`） | `scripts/lib/mock-frame.mjs` の `frameHtml` | 390 / 1280 を iframe で切り替える。製品には無い |

付箋の script は `sanitizeHtml` の**あと**に足します。先に足すと、製品側の `<script>` を落とす処理に
巻き込まれて消えます。`scripts/check-mock-sync.mjs` は、目録の各 HTML に `data-mock-shell` と
`mock-interactions.js` が無ければ `npm run check` を止めます。

付箋は既定で閉じており、押すたびに開閉します（`aria-expanded` と `Esc`）。状態はページの中だけで
持ち、次の画面へは持ち越しません。製品の `.action-dock` や `.profile-actions` が画面下に固定される
画面では、付箋だけをその上へ逃がします（製品の帯は本物の位置のまま撮ります）。

枠の中では付箋を出しません（`mock-shell.js` が `?embed=1` を見て省きます）。
`HTML をそのまま開く` は `embed` を付けないので、付箋つきで開きます。

### 音声入力の写しは製品に合わせて手で直す

`mock-interactions.js` は音声パネルも組み立てます。製品の音声入力（欄のまわりだけを残す黒い覆い、
既定でオンになる「任意の項目も聞く」、郵便番号からの住所補完）を変えたら、**同じ PR でこのファイルも直します**。
撮り直しても戻らないためです。`npm run check` は、この 3 つが消えていないかも見ます。

見た目と動きの確かめは `npm run mock:serve` で `mock-create.html` を開き、右下のマイクを押して行います。
郵便番号の見本は `1540005`（東京都世田谷区三宿）で、音声で入れると都道府県・市区町村・町域が埋まり、
次は番地に進みます。

## 遷移リンクと操作

### リンクは URL の型で解決する

内部リンクは、目録（`scripts/lib/mock-screens.mjs`）のパスに**完全一致**すればそのモックへ向けます。
催しや主催者の ID は撮るたびに変わるので、完全一致だけだと一覧の「編集」「参加者を見る」が
全部 `#` になっていました。`linkTargets(rows, demo)` は、目録のパスに出てくるデモ ID を `*` に
置き換えた型も登録します。

| 製品のリンク | 向くモック |
| --- | --- |
| `/organizer/events/<任意ID>/edit` | `mock-edit.html` |
| `/organizer/events/<任意ID>/participants` | `mock-roster.html` |
| `/organizer/events/<任意ID>/revenue` | `mock-revenue-detail.html` |
| `/events/<任意ID>` | `mock-event.html` |

`*` は 1 セグメントだけに当たります。セグメント数が同じ型どうしでは、`*` が少ない（文字が合う
ところが多い）型を選びます。クエリとハッシュは従来どおり落とします。型にも合わない内部リンクは
`#` のままです（API が要るので、遷移しないことを許容します）。

### 製品の別状態は「隠し DOM」として合成する

製品は「開いているステップ」の本文と「選んでいる日」の一覧しか描きません。モックは 1 枚で
操作を再現したいので、残りを取りに行きます。

1. `markVariants`（`scripts/lib/capture-core.mjs`）が、HTML を読む前に属性だけ付ける
   （`data-mock-date` / `data-mock-cal-section` / `data-mock-step-key` / `data-mock-step-body`）。見た目は変えない。
   日別の一覧は、カレンダーの次の `section` の見出しが選んだ日の「10月28日」で始まるときだけ控える
   （その月の催しをまとめて出す画面は、日付を押しても中身が変わらないため）
2. `readHtml` で撮り、`sanitizeHtml` した HTML の指紋（`sourceHash`）を作る
3. 断片の控え（`storage/mock-variants/<mock-*.html の語幹>.json`）が指紋と合えばそれを使う。
   無ければ `collectVariants` が日付とステップを実際に押して、製品が描いた DOM をそのまま集める
4. `mergeVariants`（`scripts/lib/mock-variants.mjs`）が、閉じている本文と選んでいない日の一覧を
   `data-mock-hidden="true"` 付きで差し込む
5. `mock-interactions.js` が `data-mock-hidden` を出し入れする

押して集めるのは**撮影のあと**です。押した状態が PNG に残らないようにするためです。
集め終えたら元の日付に戻し、先頭へスクロールします。

### 控え（2 回目以降を短くする）

| 控え | 置き場所（コミットしない） | 何を省くか | 無効になる条件 |
| --- | --- | --- | --- |
| 断片 | `storage/mock-variants/<画面>.json` | 日付・ステップを押して集める往復（1 画面 1〜6 秒） | 合成前の HTML の指紋（`sourceHash`）が変わったとき。`--refresh` でも捨てる |
| CSS | `storage/mock-assets.json`（`{ uiHash, stylesheets }`） | 同じ CSS を画面ごとに取り直す往復 | `uiHash` が変わったとき。`--refresh` でも捨てる |
| 素材（同一実行内） | メモリの表 | 同じ画像を 48 画面ぶん取り直す往復 | 実行が終われば消える |
| PNG | `storage/mock-shots/*.png` | 変化の無い画面の 390 / 1280 撮影 | 生成した HTML が既存ファイルと違うとき、PNG が欠けているとき、`--refresh` |

DB やデモデータが変われば画面上の DOM も変わるので、断片の控えは自然に外れます。画像だけが
変わった場合など、DOM に出ない差分は `npm run mock:sync -- --refresh` で取り直してください。
`public/samples/**` を差し替えたときも、素材は指紋（`computeUiHash`）に入らないため同じ扱いです
（作り直したらサンプルも更新する決まりは `AGENTS.md` の「チラシの見本」）。

### セマンティックテーマは属性を差し替えて撮る

公開プロフィールの紙面は、サーバーが `data-semantic-theme` 属性を 1 つ出すだけで決まります
（色は `src/styles/themes.css` の静的 CSS）。そのため、テーマごとにデモ会員を増やさず、
**同じ URL を開いて属性だけ差し替える**と、そのテーマを保存している主催者と同じ HTML になります。

目録の `states` に `theme` を書くと、`captureRow` が `applySemanticTheme`
（`scripts/lib/capture-core.mjs`）で属性を差し替えてから HTML を読みます。

| 書き方 | 撮れる状態 |
| --- | --- |
| `theme` を省く | DB に保存されているテーマのまま（デモは羊皮紙） |
| `theme: "neon"` | そのテーマを保存している状態。属性を書き換えるだけ |
| `theme: null` | テーマ未選択（標準）。包み（`.semantic-theme--page`）ごと外す。属性を消すだけだと `--st-*` が未定義のまま `.semantic-theme` の写しだけが残り、標準の見た目にならない |

06 主催者のページは、未ログイン・ログイン済みに加えて、標準と 9 テーマの計 12 枚を持ちます
（`mock-organizer-public-theme-neon.html` など）。テーマ名は `src/lib/semantic-themes.ts` の
ラベルと同じで、ずれると `tests/unit/mock-sync.test.mjs` が止めます。テーマを足したら、
`screens` の `states` にも 1 行足してから `npm run mock:sync` を回してください。

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
- `HTML をそのまま開く` で、枠なしのモックを開く（付箋つき）
- 一覧（`mock-index.html`）の画面名もこの枠へ入る。行の「スマホ」「PC」「HTML」で直接開ける

枠ページ・一覧・付箋の 3 ファイルは、`mock:sync` のたびに存在を確認します（消えていれば `npm run check` が止めます）。

### 撮るときの幅は 1280、見る既定は 390

`mock:sync` が保存する HTML は 1280px で 1 回だけ撮ります。CSS は `assets/<hash>.css` の別ファイルで、
メディアクエリは見る幅で効くため、390px の枠に入れれば同じ HTML がスマホの組み方になります。
幅で DOM を変えている箇所（文字を枠に合わせて縮める処理など）だけは 1280px の結果が残るので、
390px で見え方が違うときはそこを疑ってください。

製品を直すときは 390px を先に見ます。PC はそのあとです（`AGENTS.md`「画面の組み方」）。

## 生成物

| 置き場所 | コミット | 中身 |
| --- | --- | --- |
| `style-guide/mock-*.html` | する | 画面 1 枚 = 1 ファイル。状態つきは `mock-event-member.html` のように接尾辞が付く |
| `style-guide/assets/*` | する | 製品の CSS と画像。内容のハッシュが名前（同じ内容なら増えない） |
| `style-guide/mock-manifest.json` | する | 画面の一覧、各 HTML の指紋、UI ソースの指紋（`uiHash`） |
| `style-guide/mock-index.html` | する | モックの一覧ページ（生成物） |
| `style-guide/mock-frame.html` | する | 幅を選んで見る枠ページ（生成物。iframe で 390 / 1280） |
| `style-guide/mock-shell.js` | する | 付箋を組み立てる。既定は閉で、押すと開く（**手で保守する**。製品は読まない） |
| `style-guide/mock-shell.css` | する | 付箋の見た目と隠し DOM（手で保守する。`html.is-embed .mockbar` で枠の中は隠す） |
| `style-guide/mock-interactions.js` | する | モック専用の操作（**手で保守する**。製品は読まない） |
| `style-guide/mock-guide.css` | する | 一覧の行と幅の切り替え（手で保守する） |
| `storage/mock-shots/*.png` | しない | 390 / 1280 の撮影と `index.html`。目視用 |
| `storage/mock-variants/*.json` | しない | 隠し DOM の控え。消すと次の撮影で取り直す |
| `storage/mock-assets.json` | しない | CSS の対応表。消すと次の撮影で取り直す |

`style-guide/index.html` と `style-guide.css` は**部品見本**で、同期の対象外です。

## HTML をどう整えているか

`scripts/lib/mock-html.mjs`（ブラウザを知らない純ロジック）が担当します。

- `<script>`・HTML コメント・`nonce`・`data-nextjs-*`・`<next-route-announcer>` を落とす
- `<link rel="stylesheet" href="/_next/…">` の CSS を取得して `style-guide/assets/<hash>.css` に保存し、
  リンクを差し替える（Tailwind の preflight まで含めて製品と同じ見た目にするため）
- 同一オリジンの画像（`/samples/…`、`/api/v1/flyer-assets/…`、`/_next/image?…`）を取得して
  `style-guide/assets/<hash>.<ext>` に保存し、`src` と `srcset` を差し替える。`data:` はそのまま
- 内部リンクは、目録（`scripts/lib/mock-screens.mjs`）のパスに一致すればそのモックへ、
  一致しなければ `#` へ。撮るたびに変わる ID は `*` の型で照合する（上の「遷移リンクと操作」）
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

加えて、次の 3 つも見ます。

- 一覧（`mock-index.html`）・枠（`mock-frame.html`）・付箋の 2 ファイル（`mock-shell.js` / `mock-shell.css`）・操作の `mock-interactions.js`・`mock-guide.css` が実在するか
- 目録の各 HTML に、付箋の差し込み（`data-mock-shell`）があるか
- 目録の各 HTML に、操作の script（`mock-interactions.js`）があるか

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
| カレンダーの日付や音声入力が動かない | `mock-interactions.js` が読まれているか（`npm run check` が止める）。それでも動かなければ `npm run mock:sync -- --refresh` |
| 反映が古い（画像だけ差し替えた等） | `npm run mock:sync -- --refresh`（控えを使わずに取り直す） |
| 枠ページが「画面」だけになる | `mock-frame.html` が古い。`npm run mock:sync` で作り直す |

## 画面を足すとき

1. `scripts/lib/mock-screens.mjs` の `buildScreens` に 1 行足す（`no` / `slug` / `name` / `group` / `path` / `auth` / `note`）。
   同じ画面の別状態は `states` に足し、テーマを変えるだけなら `theme` も書く
2. `npm run db:seed:ui`（その画面が見るデータを足した場合）
3. `npm run mock:sync` → `style-guide/mock-*.html` と `mock-index.html` が増える
4. `npm run check` が通ることを確かめる（目録と manifest の突き合わせはここで行う）
