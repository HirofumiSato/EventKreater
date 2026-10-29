-- 参加者の出席・参加要望を主催者へ知らせるアプリ内通知。
-- メールは送らないので、宛先や配信結果の列は持たない。文面は作成時点で確定して保存する。

CREATE TYPE "NotificationKind" AS ENUM ('RSVP_ATTENDING', 'RSVP_WAITLISTED');

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "participant_id" UUID,
  "kind" "NotificationKind" NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "body" VARCHAR(300) NOT NULL,
  "dedupe_key" VARCHAR(64) NOT NULL,
  "read_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- 同じ出欠行の同じ変化を二重に作らない。同時送信はここで弾く。
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- 未読数と一覧（新しい順）を、会員 1 人の範囲で引く。
CREATE INDEX "notifications_user_id_read_at_created_at_idx"
  ON "notifications"("user_id", "read_at", "created_at");
CREATE INDEX "notifications_user_id_created_at_idx"
  ON "notifications"("user_id", "created_at");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 出欠行が消えても通知は残す。誰の表明だったかは文面に残っている。
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
