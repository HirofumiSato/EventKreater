-- 開催日時と費用を、イベント直下の繰り返し項目から子テーブルへ移す。
-- 既存の1件は「標準」プランと日時1件として引き継ぐ。

CREATE TABLE "event_schedules" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_date" DATE NOT NULL,
    "event_time" VARCHAR(50) NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "event_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_price_plans" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "price" VARCHAR(50) NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "event_price_plans_pkey" PRIMARY KEY ("id")
);

INSERT INTO "event_schedules" ("id", "event_id", "event_date", "event_time", "sort_order")
SELECT gen_random_uuid(), "id", "event_date", "event_time", 0
FROM "events";

INSERT INTO "event_price_plans" ("id", "event_id", "name", "price", "sort_order")
SELECT gen_random_uuid(), "id", '標準', "price", 0
FROM "events";

ALTER TABLE "events" ADD COLUMN "sort_date" DATE;
UPDATE "events" SET "sort_date" = "event_date";
ALTER TABLE "events" ALTER COLUMN "sort_date" SET NOT NULL;

DROP INDEX "events_status_is_deleted_event_date_idx";
DROP INDEX "events_visibility_status_is_deleted_event_date_idx";

ALTER TABLE "events" DROP COLUMN "event_date";
ALTER TABLE "events" DROP COLUMN "event_time";
ALTER TABLE "events" DROP COLUMN "price";

ALTER TABLE "event_schedules"
ADD CONSTRAINT "event_schedules_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_price_plans"
ADD CONSTRAINT "event_price_plans_event_id_fkey"
FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "event_schedules_event_id_sort_order_idx" ON "event_schedules"("event_id", "sort_order");
CREATE INDEX "event_schedules_event_date_idx" ON "event_schedules"("event_date");
CREATE INDEX "event_price_plans_event_id_sort_order_idx" ON "event_price_plans"("event_id", "sort_order");
CREATE INDEX "events_status_is_deleted_sort_date_idx" ON "events"("status", "is_deleted", "sort_date");
CREATE INDEX "events_visibility_status_is_deleted_sort_date_idx" ON "events"("visibility", "status", "is_deleted", "sort_date");

ALTER TABLE "participants" ADD COLUMN "schedule_id" UUID;
ALTER TABLE "participants" ADD COLUMN "price_plan_id" UUID;

UPDATE "participants" AS participant
SET "schedule_id" = schedule."id"
FROM "event_schedules" AS schedule
WHERE schedule."event_id" = participant."event_id"
  AND participant."status" = 'ATTENDING';

UPDATE "participants" AS participant
SET "price_plan_id" = plan."id"
FROM "event_price_plans" AS plan
WHERE plan."event_id" = participant."event_id"
  AND participant."status" = 'ATTENDING';

ALTER TABLE "participants"
ADD CONSTRAINT "participants_schedule_id_fkey"
FOREIGN KEY ("schedule_id") REFERENCES "event_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "participants"
ADD CONSTRAINT "participants_price_plan_id_fkey"
FOREIGN KEY ("price_plan_id") REFERENCES "event_price_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "participants_schedule_id_idx" ON "participants"("schedule_id");
CREATE INDEX "participants_price_plan_id_idx" ON "participants"("price_plan_id");
