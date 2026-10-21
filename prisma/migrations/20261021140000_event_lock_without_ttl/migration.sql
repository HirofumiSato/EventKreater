-- 排他編集ロックを時間制限のないロックへ変更する。
-- ロックは保持者が解放するか、他の幹事が引き継ぐまで保持される。
DROP INDEX IF EXISTS "event_locks_expires_at_idx";

ALTER TABLE "event_locks" DROP COLUMN IF EXISTS "expires_at";
