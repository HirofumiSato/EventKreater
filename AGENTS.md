# event-creater

イベント告知・出欠管理と、主催者の利用枠・Stripe 決済を扱うアプリケーションです。
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
| チラシ描画 | `services/flyer/src/**` |

- `docs/README.md` に既知の乖離をまとめてあります。まずそこを見てください。
- `docs/user-management/` と `docs/event-page/specs/` は実装前の設計です。正として扱わないでください。
- 仕様の更新が要る変更なら、コードと docs を同じ PR に入れてください。

## コードの探し方

| 探すもの | 場所 | 規則 |
| --- | --- | --- |
| API | `src/app/api/v1/**/route.ts` | ディレクトリがそのまま URL |
| 画面 | `src/app/**/page.tsx` | ディレクトリがそのままパス |
| 画面のクライアント側 | 同じディレクトリの `*Client.tsx` | サーバーは OGP・初期データのみ |
| 純ロジック | `src/modules/<機能>/lib/*.ts` | DOM と Next に依存しない。テスト対象 |
| UI | `src/modules/<機能>/components/` | ロジックを持たない |
| 横断ユーティリティ | `src/lib/` | `schemas.ts`（zod）、`serializers.ts`、`problem.ts`（RFC 7807） |
| DB | `prisma/schema.prisma` | 変更は `prisma/migrations/` に追加 |
| 振る舞いの仕様 | `tests/**/*.test.ts` | テスト名が日本語の仕様文になっている |

機能は `src/modules/` の 12 個（account, admin, attendance, auth, billing, events, flyers, media, organizers, participants, receipts, revenue）に対応します。

## コマンド

```powershell
npm run check        # lint + tsc --noEmit + Vitest
npm run test:db      # 実 DB の結合テスト（TEST_DATABASE_URL が要る）
npm run docs         # Sphinx の HTML を docs/_build/html に生成
npm run docs:gen     # 索引 4 点を再生成（doc-index.json / api-routes.md / traceability.md / llms.txt）
npm run docs:links   # 原稿と索引に書かれたリポジトリ内パスの実在を確認
cd services/flyer; python -m pytest -q
cd services/flyer; python -m mypy   # src の型（mypy.ini が strict）
```

## 規約

- コメント・文書・コミットメッセージは日本語で書きます。
- `docs/doc-index.json`、`docs/api-routes.md`、`docs/traceability.md`、`llms.txt` は `npm run docs:gen` の生成物です。手で編集せず、原稿かコードを直してから再生成してください。
- ルートビルドで有効な Sphinx の設定は `docs/conf.py` だけです。`docs/{event-page,flyer,user-management}/conf.py` は単独ビルド用です。
- `.env` は読みません。`.env.example` を見てください。
- 生成物と巨大な依存は読みません: `docs/_build`, `.next`, `node_modules`, `.venv-docs`, `storage`, `logs`。

## サブディレクトリ

- `services/flyer/AGENTS.md` — Python 側の設計規約（Ports & Adapters、例外、描画境界、pytest）。このファイルと階層結合されます。
