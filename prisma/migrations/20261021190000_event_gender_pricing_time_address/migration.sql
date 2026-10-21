-- 費用プランに「対象（男女共通/男性/女性）」と金額（整数円）を持たせる。
CREATE TYPE "PriceAudience" AS ENUM ('ANY', 'MALE', 'FEMALE');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- AlterTable: 開催場所を構造化して保持する。location は表示用に残す。
ALTER TABLE "events" ALTER COLUMN "location" TYPE VARCHAR(255);
ALTER TABLE "events" ADD COLUMN     "postal_code" VARCHAR(7);
ALTER TABLE "events" ADD COLUMN     "prefecture" VARCHAR(20);
ALTER TABLE "events" ADD COLUMN     "city" VARCHAR(100);
ALTER TABLE "events" ADD COLUMN     "town" VARCHAR(100);
ALTER TABLE "events" ADD COLUMN     "address_line" VARCHAR(200);
ALTER TABLE "events" ADD COLUMN     "building" VARCHAR(150);
ALTER TABLE "events" ADD COLUMN     "venue_name" VARCHAR(150);

-- AlterTable: 開始・終了時刻。既存行は NULL のまま event_time を表示に使う。
ALTER TABLE "event_schedules" ADD COLUMN     "start_time" VARCHAR(5);
ALTER TABLE "event_schedules" ADD COLUMN     "end_time" VARCHAR(5);

-- AlterTable: 費用プラン。amount はバックフィル前の既定値 0（無料）。
ALTER TABLE "event_price_plans" ADD COLUMN     "audience" "PriceAudience" NOT NULL DEFAULT 'ANY';
ALTER TABLE "event_price_plans" ADD COLUMN     "amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "event_price_plans" ADD COLUMN     "note" VARCHAR(100);
ALTER TABLE "event_price_plans" ALTER COLUMN "price" DROP NOT NULL;

-- AlterTable: 参加者の性別。
ALTER TABLE "participants" ADD COLUMN     "gender" "Gender";

-- 旧・費用文から金額と補足を取り出す（取りこぼしは scripts/backfill-event-details.mjs で補う）。
UPDATE "event_price_plans"
SET "amount" = COALESCE(
  NULLIF(replace((regexp_match("price", '([0-9][0-9,]*)\s*円'))[1], ',', ''), '')::int,
  0
)
WHERE "price" IS NOT NULL;

UPDATE "event_price_plans"
SET "note" = NULLIF(
  trim(both ' ' from regexp_replace(regexp_replace("price", '^[^（(]*[（(]', ''), '[）)]\s*$', '')),
  ''
)
WHERE "price" LIKE '%（%' OR "price" LIKE '%(%';

-- CreateIndex
CREATE UNIQUE INDEX "event_price_plans_event_id_audience_name_key"
  ON "event_price_plans"("event_id", "audience", "name");
