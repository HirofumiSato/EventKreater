-- 不足していた索引を 8 本足す。どれも「絞り込み + 並び替え」または「全表の掃除」に使う。
-- 追加するだけで、列・制約・既存の索引には触らない。
--
-- ── なぜ `CONCURRENTLY` を使わないか ─────────────────────────────
-- 以前は `CREATE INDEX CONCURRENTLY` で張っていた。書き込みを止めない代わりに、
-- トランザクションの中で実行できない。Prisma Migrate は 1 つのマイグレーションを
-- トランザクションで包むため、このファイルを `npx prisma migrate deploy` に流すと
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- で必ず止まる。CI の `db` ジョブ、`docker compose`、新しい開発環境、Neon の
-- 作り直しは、どれも `migrate deploy` で履歴を再生するので、空の DB から
-- スキーマを作れなくなっていた。
--
-- いまは通常の `CREATE INDEX` にする。1 つのトランザクションで 8 本を作るので、
-- 途中で失敗すれば全部巻き戻る（`CONCURRENTLY` のように INVALID な索引は残らない）。
-- ビルドのあいだは書き込みが止まるが、この規模では 1 本あたり数十ミリ秒で済む。
--
-- 行数が大きく、止めたくない環境では、当てる直前にアプリの書き込みを止めるか、
-- 手作業で `CONCURRENTLY` を流してから `migrate resolve --applied` する
-- （履歴に記録済みなら `migrate deploy` はこのファイルを流さない）。
--
-- `IF NOT EXISTS` を付けているので、手で先に張った索引があっても衝突しない。

-- 紹介した人数の数え上げ（`referred_by_user_id` + `deleted_at IS NULL`）。
CREATE INDEX IF NOT EXISTS "users_referred_by_user_id_idx"
  ON "users"("referred_by_user_id");

-- 管理画面の会員一覧（作成の新しい順 + ページ送り）。
CREATE INDEX IF NOT EXISTS "users_created_at_idx"
  ON "users"("created_at");

-- 管理画面の支払い一覧（作成の新しい順 + ページ送り）。
CREATE INDEX IF NOT EXISTS "billing_transactions_created_at_idx"
  ON "billing_transactions"("created_at");

-- 管理画面のイベント一覧（作成の新しい順 + ページ送り）。
CREATE INDEX IF NOT EXISTS "events_created_at_idx"
  ON "events"("created_at");

-- 参加者の履歴の見出し（本人 × 出席・欠席・参加要望 × 未削除）。
-- 一覧の並びは既存の (user_id, updated_at) が受け持つ。
CREATE INDEX IF NOT EXISTS "participants_user_id_status_deleted_at_idx"
  ON "participants"("user_id", "status", "deleted_at");

-- 主催イベント一覧（本人のぶんを新しい順）。
-- 既存の (user_id) は前方一致で使えるので残す（他画面がそのまま使う）。
CREATE INDEX IF NOT EXISTS "event_organizers_user_id_created_at_idx"
  ON "event_organizers"("user_id", "created_at");

-- チラシ選択の一覧（本人 × 未削除を新しい順に 60 件）。
CREATE INDEX IF NOT EXISTS "flyer_assets_user_id_is_deleted_created_at_idx"
  ON "flyer_assets"("user_id", "is_deleted", "created_at");

-- 試行回数の掃除（1 日より古い行を `created_at` だけで消す）。
CREATE INDEX IF NOT EXISTS "auth_attempts_created_at_idx"
  ON "auth_attempts"("created_at");
