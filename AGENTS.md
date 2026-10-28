# event-creater

イベント告知・出欠管理と、主催者の利用枠・Stripe 決済を扱うアプリケーションです。
飯フェス、タコパ、ライブ、占い、撮影会などの主催者が、参加者へ直接URLを届ける用途を主対象にします。
Next.js 14（App Router）+ Prisma + PostgreSQL。チラシ生成のみ Python の独立サービス（`services/flyer`、FastAPI + Pillow + OpenAI）です。

## 最初に読む順

0. `llms.txt` — AI 向けの入口。最初に読む 21 リンクだけを置く
1. `docs/onboarding.md` — 全体を 90 分で掴む順路。人間と AI が同じものを使う
2. `docs/README.md` — どの文書が何から派生し、何で検証されるか。既知の乖離もここにある
3. `docs/sitemap.rst` — ドキュメント全体の見取り図。`toctree` に無いページは検索にも出ない
4. `docs/backend_api_implementation_spec.md` / `docs/front_implementation_spec.md` — API と画面の仕様

全文書の一覧は `docs/doc-index.json` で引けます。タイトル・要約・見出し・toctree・参照コードが入っています。

## 正しさの基準

正はコードです。docs はその検証面であり、差分を見つけたら同じ PR で直します。

| 対象 | 正 |
| --- | --- |
| DB 物理設計 | `prisma/schema.prisma`（`docs/DBschema.md` は解説） |
| API 契約 | `src/app/api/**/route.ts`（ディレクトリがそのまま URL） |
| 画面 | `src/app/**/page.tsx` |
| 共通スタイル | `src/styles/**/*.css`（モックも同じファイルを読む） |
| 共通 UI 部品 | `src/components/ui/**` |
| チラシ描画 | `services/flyer/src/**` |

- `docs/README.md` に既知の乖離をまとめてあります。まずそこを見てください。
- `docs/archive/` は実装前の設計です。正として扱わないでください。
- 仕様の更新が要る変更なら、コードと docs を同じ PR に入れてください。

## コードの探し方

| 探すもの | 場所 | 規則 |
| --- | --- | --- |
| API | `src/app/api/v1/**/route.ts` | ディレクトリがそのまま URL |
| 画面 | `src/app/**/page.tsx` | ディレクトリがそのままパス |
| 画面のクライアント側 | 同じディレクトリの `*Client.tsx` | サーバーは OGP・初期データのみ |
| 純ロジック | `src/modules/<機能>/lib/*.ts` | DOM と Next に依存しない。テスト対象 |
| UI | `src/modules/<機能>/components/` | ロジックを持たない |
| 共通 UI 部品 | `src/components/ui/` | `PageHeader`、`Section`、`Panel`、`Rows`、`Alert`、`Loading`、`EmptyState`、`Badge`、`Dialog`、`Field`。ブロックを直すときはここを 1 回直す |
| 共有スタイル | `src/styles/` | `index.css` が入口。`tokens` → `base` → `components` → `screens` → `deco` → `themes`（最後）の順 |
| 横断ユーティリティ | `src/lib/` | `schemas.ts`（zod）、`serializers.ts`、`problem.ts`（RFC 7807）、`format.ts`（金額・日付） |
| DB | `prisma/schema.prisma` | 変更は `prisma/migrations/` に追加 |
| 振る舞いの仕様 | `tests/**/*.test.ts` | テスト名が日本語の仕様文になっている |

機能は `src/modules/` の 12 個（account, admin, attendance, auth, billing, events, flyers, media, organizers, participants, receipts, revenue）に対応します。

## コマンド

```powershell
npm run check        # 速い検査: eslint（キャッシュ）+ tsc --noEmit + mock-sync（同期漏れ）
npm run check:full   # 上に Vitest と docs のテスト件数照合を足す（CI と PR の前）
npm run mock:sync    # 製品の DOM から style-guide/mock-*.html を作り直す（--only=20 / --no-shots / --dev）
npm run mock:check   # モックが製品のソースと同期しているかだけを見る
npm run mock:serve   # 生成したモックを 127.0.0.1:4321 で配信
npm run test:db      # 実 DB の結合テスト（TEST_DATABASE_URL が要る）
npm run docs         # Sphinx の HTML を docs/_build/html に生成
npm run docs:gen     # 索引 4 点を再生成（doc-index.json / api-routes.md / traceability.md / llms.txt）
npm run docs:counts  # テストの件数を docs/testing/scope.rst へ書き戻す
npm run docs:links   # 原稿と索引に書かれたリポジトリ内パスの実在を確認
cd services/flyer; python -m pytest -q
cd services/flyer; python -m mypy   # src の型（mypy.ini が strict）
```

## 作業ツリー

既定は「作業ブランチを 1 本切り、1 つのツリーで進める」です。`main` へは PR で入れます。
必須チェック（`check` / `db` / `flyer`）は PR でしかゲートにならないためです（`docs/testing/ci.rst`）。

1. 作業を始める前に、前の作業をコミットする。`style-guide/**` の生成物はコミットまでを 1 セットにする
2. `main` から `feat/...` か `fix/...` を切る。実装・`mock:sync`・検証はそのブランチで行う
3. PR を出し、必須チェックが緑になってからマージする

`git worktree` は、未コミットを残したまま並行作業が要るときだけ使います。
OneDrive 配下なので、ツリーを増やすと `node_modules` と `.next` が二重になります。
マージしたら `git worktree remove` で片付け、ブランチも消します。残すのは今触っている 1 つだけです。
`main` に未コミットが残っている状態で別件を始めるときは、worktree ではなくまずコミットします。

## 製品→モックの同期（必須ループ）

**製品が正**です。`style-guide/mock-*.html` は製品の DOM を写した生成物で、手で編集しません。
比較（parity）はしません。見た目を変えたら、次を同じ PR で終わらせます。

モックだけが持つものは 4 つです。画面下部の帯（`style-guide/mock-shell.js` / `mock-shell.css`）、
操作の script（`style-guide/mock-interactions.js`）、画面の一覧（`style-guide/mock-index.html`）、
幅の枠（`style-guide/mock-frame.html`）。
帯と操作の script は `scripts/lib/mock-html.mjs` の `withMockShell` / `withMockInteractions` が
`sanitizeHtml` のあとに差し込むので、撮り直しても消えません。消せば `npm run check` が止まります。
帯・操作・一覧の CSS/JS だけは手で保守します。

```powershell
npm run db:seed:ui   # 初回と、データを作り直すときだけ
npm run mock:sync    # 全 33 画面を撮り直す（既定は本番ビルド。30〜35 秒＋ビルド）
npm run mock:sync -- --only=20,24   # 直した画面だけ（1 画面 5 秒前後）
npm run mock:sync -- --refresh      # 控え（隠し DOM・CSS・PNG）を使わず取り直す
npm run check        # 同期漏れをハッシュで確認（ブラウザも DB も使わない）
npm run check:full   # PR の直前に 1 回（Vitest 込み）
```

1. 製品を直す（`src/styles/**` → `src/components/ui/**` → 画面 TSX の順）
2. `npm run mock:sync` でモックを差し替える。部分同期で済ませたときは、コミット前に全体を回す
3. `style-guide/mock-*.html`・`style-guide/assets/`・`mock-manifest.json`・`mock-index.html` をコミットする
4. PNG（`storage/mock-shots/`）と控え（`storage/mock-variants/`・`storage/mock-assets.json`）はコミットしない

撮り直しは控えで短くなります。隠し DOM（閉じているステップの本文・選んでいない日の一覧）は
`storage/mock-variants/` に、CSS は `storage/mock-assets.json` に残り、HTML が変わらない画面は撮影を省きます。
画像だけを差し替えたときなど、DOM に出ない差分は `--refresh` で取り直してください。

同期漏れは `npm run check` が止めます。どうしても通すときだけ `MOCK_SYNC_ALLOW_STALE=1` を付け、
PR に理由を書きます。手順の正は `docs/ui-review/mock-sync.md` です。

## 画面の組み方（スマホが先）

参加者はスマホで開き、主催者の PC は従です。画面は幅 390px を基準に組み、広い画面向けの差分だけを足します。

- メディアクエリの外（既定）はスマホの見た目にします。PC 用の指定を既定に置き、`max-width` でスマホへ戻す書き方はしません。
- 広い画面向けの差分は `min-width` で足します。`max-width` は、狭い画面だけを詰める指定と、`min-width` の対（`min-width: 640px` に対する `max-width: 639px`）だけに使います。
- 幅の段は `640` / `768` / `900` / `1024`（広げる）と `360` / `400` / `480` / `540`（狭める）だけです。段を増やすときは `tests/unit/style-breakpoints.test.mjs` の表も同じ PR で直します。
- 狭い端末（360px 級）でも横スクロールを出しません。確認は `npm run mock:sync` の 390 / 1280 の撮影で行います。
- 参加者の画面ほど「片手で完結するか」を先に確かめます。PC で崩れないことは、スマホで使えることの代わりになりません。

## 規約

- コメント・文書・コミットメッセージは日本語で書きます。
- 見た目の変更は `src/styles/**` の 1 箇所、ブロック構造の変更は `src/components/ui/**` の 1 箇所で済ませます。ページ側に同じクラスの組み立てを書き戻さないでください。
- 金額と日付の文字列は `src/lib/format.ts` を通します。`toLocaleString` を画面に直書きしません（通貨が JPY でない管理画面など、意図がある場所はコメントを残します）。
- `docs/doc-index.json`、`docs/api-routes.md`、`docs/traceability.md`、`llms.txt` は `npm run docs:gen` の生成物です。手で編集せず、原稿かコードを直してから再生成してください。
- テストの件数は `docs/testing/scope.rst` の 1 か所だけが持ちます。`npm run docs:counts` が Vitest の結果から書き戻し、`npm run check:full` がずれを検出します。テストを足したら件数も更新してください。
- ルートビルドで有効な Sphinx の設定は `docs/conf.py` だけです。`docs/{event-page,flyer,user-management}/conf.py` は単独ビルド用です。
- `.env` は読みません。`.env.example` を見てください。
- 生成物と巨大な依存は読みません: `docs/_build`, `.next`, `node_modules`, `.venv-docs`, `storage`, `logs`。

## サブディレクトリ

- `services/flyer/AGENTS.md` — Python 側の設計規約（Ports & Adapters、例外、描画境界、pytest）。このファイルと階層結合されます。
