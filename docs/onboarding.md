# 全体を掴む 90 分

このリポジトリは実装が正で、ドキュメントはその検証面です。
上から順に進めると、画面・API・DB・テストが 1 本に繋がります。所要は 90 分です。

読み終えたら [README.md](README.md) で「どの文書が何を説明しているか」と「既知の乖離」を確認してください。

## 0. 動かす（15 分）

[docs/local.rst](local.rst) の「初回セットアップ」に従います。

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

`npm run dev` は Web（`http://localhost:3012`）とチラシ生成 API（`http://127.0.0.1:8000`）を同時に起動します。

開く画面は 3 つだけで足ります。

| URL | 何の画面か |
| --- | --- |
| `/` | サービス紹介。ここからイベント一覧へは行かない |
| `/events/[id]` | 公開告知と出欠。このアプリの中心 |
| `/organizer/events` | 主催者の一覧。利用枠の残数と Stripe ポータル |

## 1. 1 画面を縦に貫く（25 分）

`/events/[id]` を上から下へ 5 ファイル読むと、このリポジトリの標準形が分かります。

```text
src/app/events/[id]/page.tsx           サーバー側。OGP のためだけに prisma を読む
src/app/events/[id]/EventPageClient.tsx クライアント側。本文は API から取る
src/modules/events/components/         表示。ロジックを持たない
src/app/api/v1/public/events/[id]/route.ts  認可・検証・シリアライズ
src/modules/events/lib/rsvp-status.ts  純ロジック。テスト対象
```

読むときの着眼点は 3 つです。

- サーバー側は `generateMetadata` で OGP を作るために DB を読み、本文はクライアントが API を叩きます。`export const dynamic = "force-dynamic"` の理由もここにあります。
- クライアントは `src/lib/problem.ts` の `readProblem` で RFC 7807 のエラーを読みます。エラー表現は全 API で共通です。
- 振る舞いの仕様はテスト名に書いてあります。[tests/unit/rsvp-status.test.ts](../tests/unit/rsvp-status.test.ts) の `describe` と `it` を読むだけで、満員・待機・残席の扱いが分かります。

```powershell
npm test -- tests/unit/rsvp-status.test.ts
```

## 2. 課金を横に貫く（20 分）

利用枠は「イベントを作るとき」だけ消費されます。参加者の出欠では消費しません。

```text
src/modules/billing/lib/quota.ts        consumeEventQuota が枠を 1 つ減らす
src/modules/events/lib/events.ts        イベント作成のトランザクションから呼ばれる
src/app/api/v1/billing/checkout/*       Stripe Checkout へ遷移
src/app/api/v1/billing/checkout/verify  戻ってきた直後の同期検証
src/app/api/v1/webhooks/stripe          非同期の確定。冪等
```

DB は 3 つだけ追えば足ります。

| モデル | 役割 |
| --- | --- |
| `UserUsageQuota` | 残数・サブスクの状態・期間 |
| `BillingTransaction` | 決済履歴 |
| `StripeWebhookEvent` | Webhook の冪等キー |

`quota.ts` の `consumeEventQuota` を読むと、`PAST_DUE` の拒否、サブスク有効なら無制限、単発クレジットの減算、無料枠の順に判定していることが分かります。

## 3. チラシ生成（15 分）

Python の独立サービスです。Next.js からは HTTP で呼ぶだけで、DB には触れません。

- 入口: [flyer/catchup/index.rst](flyer/catchup/index.rst)。Web・画像・AI・Python の前提を先に置いています
- 全体: [flyer/index.rst](flyer/index.rst) と [flyer/architecture.rst](flyer/architecture.rst)
- 実装の規約: `services/flyer/AGENTS.md`

Next.js 側は `src/modules/flyers/` です。`quota.ts` はチラシ生成回数の制限で、イベント作成の利用枠とは別物です。混同しないでください。

## 4. 検証（15 分）

```powershell
npm run check        # lint + tsc --noEmit + Vitest（289 件）
npm run test:db      # 実 DB の結合テスト（59 件。TEST_DATABASE_URL が要る）
npm run docs         # Sphinx
npm run docs:links   # docs に書かれたパスの実在確認
cd services/flyer; python -m pytest -q
```

CI は `changes`・`check`・`db`・`flyer`・`docs` の 5 ジョブです（[../.github/workflows/ci.yml](../.github/workflows/ci.yml)）。先頭の `changes` が PR の変更ファイルを見て、`docs` だけの変更なら `check` と `db` を、`services/flyer` の外だけの変更なら `flyer` を飛ばします。`docs` は `npm run docs:gen` の生成物が最新か、原稿のパスが実在するか、Sphinx が HTML を生成できるかを見ます。`flyer` は `services/flyer` の pytest と mypy を続けて呼びます。
読む順の詳細は [testing/index.rst](testing/index.rst) にあります。

## 掴めたかの確認

次の 3 つに答えられれば、全体像は掴めています。

1. `/events/[id]` の表示を 1 つ変えるとき、触るファイルを 5 つ挙げられるか
2. 課金の入口と出口を 1 文で言えるか（作成時の `consumeEventQuota` と、Checkout からの `verify` / Webhook）
3. docs とコードがずれていたら、どちらを直すか即答できるか（正はコード。同じ PR で docs も直す）

## 次に読む

| 目的 | 場所 |
| --- | --- |
| ドキュメントの地図 | [sitemap.rst](sitemap.rst) |
| どの文書が正か、既知の乖離 | [README.md](README.md) |
| 本番へ出す手順 | [deploy.rst](deploy.rst)（Cloudflare → Fly.io → Neon / R2） |
| 以前の要件と設計 | [archive/index.rst](archive/index.rst)（**現在の正ではない**） |
| AI エージェント向けの探索規則 | `AGENTS.md`（リポジトリ直下） |
| 画面と API の仕様 | [front_implementation_spec.md](front_implementation_spec.md) / [backend_api_implementation_spec.md](backend_api_implementation_spec.md) |
