-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'UNLISTED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateIndex
CREATE INDEX "events_visibility_status_is_deleted_event_date_idx" ON "events"("visibility", "status", "is_deleted", "event_date");

-- AlterTable
ALTER TABLE "flyer_assets" ADD COLUMN "user_id" UUID,
ADD COLUMN "owner_token_hash" VARCHAR(64),
ADD COLUMN "title" VARCHAR(100),
ADD COLUMN "event_date" DATE,
ADD COLUMN "event_time" VARCHAR(50),
ADD COLUMN "price" VARCHAR(50),
ADD COLUMN "location" VARCHAR(150),
ADD COLUMN "rain_policy" "RainPolicy",
ADD COLUMN "capacity" INTEGER,
ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "flyer_assets_user_id_is_deleted_idx" ON "flyer_assets"("user_id", "is_deleted");

-- CreateIndex
CREATE INDEX "flyer_assets_owner_token_hash_is_deleted_idx" ON "flyer_assets"("owner_token_hash", "is_deleted");

-- AddForeignKey
ALTER TABLE "flyer_assets" ADD CONSTRAINT "flyer_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "recipient_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_deliveries_event_id_created_at_idx" ON "reminder_deliveries"("event_id", "created_at");

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
