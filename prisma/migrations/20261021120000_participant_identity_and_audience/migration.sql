-- 参加者を「会員」に紐づけるための一意制約と、登録入口の記録。

-- 1) 同じ会員が同じイベントに複数行を持っている場合、最後に更新された 1 行だけを残す。
--    一意制約を張る前の後始末。匿名行（user_id IS NULL）は対象外。
DELETE FROM "participants" AS target
USING "participants" AS newer
WHERE target."user_id" IS NOT NULL
  AND target."user_id" = newer."user_id"
  AND target."event_id" = newer."event_id"
  AND (
    newer."updated_at" > target."updated_at"
    OR (newer."updated_at" = target."updated_at" AND newer."id" < target."id")
  );

-- 2) 会員 1 人につきイベント 1 行。匿名行は NULL なので重複を許す。
CREATE UNIQUE INDEX "participants_event_id_user_id_key" ON "participants"("event_id", "user_id");

-- 3) 参加履歴の並び替え（updated_at desc）用。
CREATE INDEX "participants_user_id_updated_at_idx" ON "participants"("user_id", "updated_at");

-- 4) 参加者向けログインの purpose。
ALTER TYPE "LoginChallengePurpose" ADD VALUE IF NOT EXISTS 'PARTICIPANT';

-- 5) 登録を始めた入口。
CREATE TYPE "SignupAudience" AS ENUM ('ORGANIZER', 'PARTICIPANT');
ALTER TABLE "signup_intents"
  ADD COLUMN "audience" "SignupAudience" NOT NULL DEFAULT 'ORGANIZER';
