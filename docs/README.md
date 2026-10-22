# ドキュメントの派生・検証マップ

正はコードです。このディレクトリの文書はコードの検証面であり、差分を見つけたら同じ PR で文書も直します。

まず全体を掴みたいときは [onboarding.md](onboarding.md)、地図は [sitemap.rst](sitemap.rst) です。

## 現在の正（コード）と、その解説

| 対象 | 正 | 解説する文書 | 検証方法 |
| --- | --- | --- | --- |
| DB 物理設計 | `prisma/schema.prisma` | [DBschema.md](DBschema.md) | 30 テーブルの照合 |
| API 契約（Next.js） | `src/app/api/**/route.ts` | [backend_api_implementation_spec.md](backend_api_implementation_spec.md) | 73 ルートの照合 |
| 画面 | `src/app/**/page.tsx` | [front_implementation_spec.md](front_implementation_spec.md) | 35 ページの照合 |
| チラシ描画 | `services/flyer/src/**` | [flyer/specs/implementation_spec.md](flyer/specs/implementation_spec.md) | pytest 52 件 |
| テスト範囲 | `tests/**/*.test.ts` | [testing/scope.rst](testing/scope.rst) | `it` 348 件の照合 |

## 既知の乖離（2026-10-22 時点）

コードにあって文書に無いもの、文書が指すが実在しないものです。直したらこの行を消してください。

| 種別 | 件数 | 内容 |
| --- | --- | --- |
| API | 3 | `POST /api/v1/organizer/events/[id]/lifecycle`、`DELETE /api/v1/organizer/events/[id]/organizers/[organizerId]`、`GET /api/v1/user/calendar` |
| DB | 1 | `reminder_deliveries`（`ReminderDelivery`） |
| パス | 5 | `src/lib/guards.ts`、`src/lib/response.ts`、`src/lib/quota.ts`、`src/lib/db.ts`、`src/types/event.ts`。いずれも仕様書が指す名前で実装されていない |
| 手順 | 1 | `user-management/local_environment.md` の URL が `localhost:3000` と `/api/v1/health`。現在は 3012 で、health のルートは無い |

テスト件数は [testing/scope.rst](testing/scope.rst) の記載（348 件）と実測が一致しています。パスの乖離は [../scripts/check-doc-links.mjs](../scripts/check-doc-links.mjs) の `KNOWN_MISSING` に登録してあり、検査は通ります。

## 実装前の設計（現在の正ではない）

次の 2 つは企画段階の上流設計書です。現在の実装と一致しない箇所があるため、正として扱わないでください。13 ファイルの冒頭にも同じ注意を書いてあります。

- `user-management/` — 会員登録管理。ルート直下の同名文書に統合済み（`local_environment.md` だけは現在の手順書）
- `event-page/specs/` — イベント告知ページ。ルート直下の同名文書に統合済み

## 単独ビルド用の設定

ルートビルドで有効な Sphinx の設定は [conf.py](conf.py) だけです。
`{event-page,flyer,user-management}/conf.py` はその章だけを単独でビルドするときの設定で、ルートの `toctree` からは使われません。

## 検査

```powershell
npm run docs:links   # 本文中の src/ tests/ prisma/ などのパスの実在を確認
npm run docs         # Sphinx の HTML を docs/_build/html に生成
```

`docs:links` は [../scripts/check-doc-links.mjs](../scripts/check-doc-links.mjs) が担当します。`docs/**` に加えて、`AGENTS.md`、`README.md`、`services/flyer/AGENTS.md`、`services/flyer/README.md` も検査します。
