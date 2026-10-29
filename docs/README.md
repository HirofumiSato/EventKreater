# ドキュメントの派生・検証マップ

正はコードです。このディレクトリの文書はコードの検証面であり、差分を見つけたら同じ PR で文書も直します。

まず全体を掴みたいときは [onboarding.md](onboarding.md)、地図は [sitemap.rst](sitemap.rst) です。

## 現在の正（コード）と、その解説

| 対象 | 正 | 解説する文書 | 検証方法 |
| --- | --- | --- | --- |
| DB 物理設計 | `prisma/schema.prisma` | [DBschema.md](DBschema.md) | 33 テーブルの照合 |
| API 契約（Next.js） | `src/app/api/**/route.ts` | [backend_api_implementation_spec.md](backend_api_implementation_spec.md) | 81 ルートの照合 |
| 画面 | `src/app/**/page.tsx` | [front_implementation_spec.md](front_implementation_spec.md) | 37 ページの照合 |
| チラシ描画 | `services/flyer/src/**` | [flyer/specs/implementation_spec.md](flyer/specs/implementation_spec.md) | pytest 304 件 + `mypy`（src の strict） |
| モック（製品の写し） | `src/app/**`・`src/styles/**` などの UI ソース | [ui-review/mock-sync.md](ui-review/mock-sync.md) | `npm run check`（ソースの指紋と `mock-manifest.json` の一致）。生成は `npm run mock:sync` |
| テスト範囲 | `tests/**/*.test.ts` | [testing/scope.rst](testing/scope.rst) | `it` の件数の照合（`npm run docs:counts` が生成） |

## 既知の乖離（2026-10-22 時点）

コードにあって文書に無いもの、文書が指すが実在しないものです。直したらこの行を消してください。

| 種別 | 件数 | 内容 |
| --- | --- | --- |
| API | 6 | 仕様書に無い実装。`GET /api/v1/organizer/events/[id]/organizers`、`DELETE /api/v1/organizer/events/[id]/organizers/[organizerId]`、`POST /api/v1/invitations/[code]`（仕様は GET のみ）、`DELETE /api/v1/flyer-assets/[id]`、`GET /api/v1/geo/postal-codes/[code]`、`GET /api/v1/user/calendar`。一覧は [api-routes.md](api-routes.md) |
| DB | 1 | `reminder_deliveries`（`ReminderDelivery`） |
| パス | 5 | `src/lib/guards.ts`、`src/lib/response.ts`、`src/lib/quota.ts`、`src/lib/db.ts`、`src/types/event.ts`。いずれも仕様書が指す名前で実装されていない |
| 手順 | 1 | `archive/user-management/local_environment.md` の URL が `localhost:3000` と `/api/v1/health`。現在は 3012 で、health のルートは無い。アーカイブ済みなので直さない |

テスト件数は [testing/scope.rst](testing/scope.rst) だけが持ちます。`npm run docs:counts` が Vitest の結果から書き戻し、`npm run check:full` がずれを検出して止めます。原稿を足したりテストを書いたりしたら、この 1 コマンドで揃えてください。パスの乖離は [../scripts/lib/docs-util.mjs](../scripts/lib/docs-util.mjs) の `KNOWN_MISSING` に登録してあり、検査は通ります。

## 生成された索引

`npm run docs:gen` が次の 4 つを作ります。`npm run check:full` は、テストの件数が原稿と合っているかも見ます。どちらも手で編集しないでください。CI は生成後に差分が出ないことを確かめます。

| ファイル | 内容 |
| --- | --- |
| [doc-index.json](doc-index.json) | 全原稿のタイトル・要約・見出し・toctree・参照コード。AI が最初に引く |
| [api-routes.md](api-routes.md) | `src/app/api/**/route.ts` の一覧と、API 仕様との差分 |
| [traceability.md](traceability.md) | コードから文書への逆引きと、文書が指す実在しないパス |
| [../llms.txt](../llms.txt) | llms.txt 形式の入口。最初に読む 22 リンクだけを置く |

## 実装前の設計（現在の正ではない）

[docs/archive/](archive/index.rst) に、企画段階の上流設計書をまとめてあります。現在の実装と一致しない箇所があるため、正として扱わないでください。各原稿の冒頭にも同じ注意を書いてあります。

- `archive/user-management/` — 会員登録管理。ルート直下の同名文書に統合済み（当時の手順書もここに移した。現在の手順は [local.rst](local.rst)）
- `archive/event-page/specs/` — イベント告知ページ。ルート直下の同名文書に統合済み

原稿の冒頭に実装前の設計である旨の注意書きがあるものは、`npm run docs:gen` の索引と `npm run docs:links` の検査から外れます。Sphinx では読めるので、履歴を追うときだけ開いてください。現在の正は上の表の「正」の列です。

## 単独ビルド用の設定

ルートビルドで有効な Sphinx の設定は [conf.py](conf.py) だけです。
`{event-page,flyer}/conf.py` はその章だけを単独でビルドするときの設定で、ルートの `toctree` からは使われません。`archive/` はルートビルドだけで読むので、単独ビルド用の設定は置いていません。

## 検査

```powershell
npm run docs:gen     # 索引 4 点を再生成。差分が出たらコミットする
npm run docs:counts  # テスト件数を testing/scope.rst へ書き戻す
npm run docs:links   # 本文中の src/ tests/ prisma/ などのパスの実在を確認
npm run docs         # Sphinx の HTML を docs/_build/html に生成
```

### `npm run check` の意味（2026-10-26 に変わった点）

`npm run check` は **速い検査**（eslint のキャッシュ実行・`tsc --noEmit`・UI の静的検査）だけを走らせ、
Vitest とこの「テスト件数の照合」は走らせません。保存のたびに回せる重さに保つためです。
**テスト込みの判定は `npm run check:full`** で、CI はこちらを呼びます。PR の前には `check:full` を通してください。

テストを足したら、これまでどおり `npm run docs:counts` で [testing/scope.rst](testing/scope.rst) を
書き戻してから `npm run check:full` を実行します（件数の照合は `check:full` の中で走ります）。

`docs:links` は [../scripts/check-doc-links.mjs](../scripts/check-doc-links.mjs) が担当します。`docs/**` に加えて、`AGENTS.md`、`README.md`、`llms.txt`、`services/flyer/AGENTS.md`、`services/flyer/README.md` も検査します。パスの拾い方と免除リストは [../scripts/lib/docs-util.mjs](../scripts/lib/docs-util.mjs) に共通化しています。

### `npm run mock:sync`（モックを撮り直すとき）

モックは製品の DOM を写した生成物です。画面を直したら `npm run mock:sync` を実行し、
`style-guide/mock-*.html` を同じ PR でコミットしてください。同期漏れは `npm run check` が
（ブラウザも DB も使わずに）止めます。手順は [ui-review/mock-sync.md](ui-review/mock-sync.md) が正です。

既定は `.next-ui-prod` に本番ビルドして別ポート（3014）で配るので、動いている `npm run dev` の
`.next` は壊しません。ビルドは `src` が変わったときだけ 1 回走ります。実測は全 39 画面で
**40〜50 秒**（ビルドを含めると 1〜2 分）、1 画面だけなら `-- --only=20` で **5 秒前後**です。
公開プロフィールの 10 枚（9 テーマと標準）は、同じ URL を属性だけ変えて撮るので 1 枚 1〜2 秒です。
