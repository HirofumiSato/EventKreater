# event-creater

イベント告知・出欠管理と、主催者の利用枠・Stripe 決済を扱うアプリケーションです。
Next.js 14（App Router）+ Prisma + PostgreSQL で動き、チラシ生成だけを Python の独立サービスに分けています。

## 起動

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Web は `http://localhost:3012`、チラシ生成 API は `http://127.0.0.1:8000` で起動します。
DB の作成とマイグレーションは [docs/local.rst](docs/local.rst) の手順に従ってください。

## 検証

```powershell
npm run check        # lint + tsc --noEmit + Vitest
npm run test:db      # 実 DB の結合テスト（TEST_DATABASE_URL が要る）
npm run docs         # Sphinx の HTML を docs/_build/html に生成
npm run docs:links   # 原稿と索引に書かれたリポジトリ内パスの実在を確認
```

チラシ生成 API のテストは `services/flyer` で `python -m pytest -q` です。

## ドキュメント

| 何を知りたいか | 開く場所 |
| --- | --- |
| 全体を 90 分で掴む | [docs/onboarding.md](docs/onboarding.md) |
| ドキュメントの地図 | [docs/sitemap.rst](docs/sitemap.rst) |
| どの文書が正か、既知の乖離 | [docs/README.md](docs/README.md) |
| AI エージェント向けの探索規則 | [AGENTS.md](AGENTS.md) |

Sphinx の HTML は `npm run docs` のあと `start docs\_build\html\index.html` で開きます。
