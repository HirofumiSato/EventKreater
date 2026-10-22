-- 定員に達した催しへの参加要望を持つ。
-- 既存行は ATTENDING / DECLINED のままで、waitlisted_at は NULL。バックフィルは要らない。
-- 新しい enum 値はこのマイグレーション内では使わないため、列追加と同じトランザクションでよい。
ALTER TYPE "RsvpStatus" ADD VALUE IF NOT EXISTS 'WAITLISTED';

ALTER TABLE "participants" ADD COLUMN "waitlisted_at" TIMESTAMPTZ;

-- 待ち順（waitlisted_at 昇順）を引くための索引。既存の (event_id, status) はそのまま残す。
CREATE INDEX "participants_event_id_status_waitlisted_at_idx"
  ON "participants"("event_id", "status", "waitlisted_at");
