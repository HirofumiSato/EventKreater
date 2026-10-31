-- DropIndex
DROP INDEX "events_quota_source_status_is_deleted_idx";

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "event_discounts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" VARCHAR(100),
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "event_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_discounts" (
    "id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "discount_id" UUID,
    "name" VARCHAR(50) NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" VARCHAR(100),
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "participant_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_discounts_event_id_sort_order_idx" ON "event_discounts"("event_id", "sort_order");

-- CreateIndex
CREATE INDEX "participant_discounts_participant_id_idx" ON "participant_discounts"("participant_id");

-- CreateIndex
CREATE INDEX "participant_discounts_discount_id_idx" ON "participant_discounts"("discount_id");

-- CreateIndex
CREATE UNIQUE INDEX "participant_discounts_participant_id_discount_id_key" ON "participant_discounts"("participant_id", "discount_id");

-- AddForeignKey
ALTER TABLE "event_discounts" ADD CONSTRAINT "event_discounts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_discounts" ADD CONSTRAINT "participant_discounts_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_discounts" ADD CONSTRAINT "participant_discounts_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "event_discounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "pricing_campaign_coupons_campaign_id_version_months_kind_plan_k" RENAME TO "pricing_campaign_coupons_campaign_id_version_months_kind_pl_key";
