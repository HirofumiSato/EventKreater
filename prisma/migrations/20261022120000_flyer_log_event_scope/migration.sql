-- チラシ生成回数をイベント単位で数える。
-- 公開前の新規作成は event_id が NULL のまま作り、公開時に付け替える。
ALTER TABLE "flyer_generation_logs" ADD COLUMN "event_id" UUID;

CREATE INDEX "flyer_generation_logs_event_id_created_at_idx"
  ON "flyer_generation_logs"("event_id", "created_at");

ALTER TABLE "flyer_generation_logs"
  ADD CONSTRAINT "flyer_generation_logs_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 既存の記録は、現在そのイベントに設定されているチラシから辿れる分だけ埋める。
UPDATE "flyer_generation_logs" AS l
SET "event_id" = e."id"
FROM "events" AS e
WHERE e."flyer_asset_id" = l."flyer_asset_id"
  AND l."flyer_asset_id" IS NOT NULL;
