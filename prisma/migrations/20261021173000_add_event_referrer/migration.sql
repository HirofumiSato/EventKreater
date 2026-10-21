-- AlterTable
ALTER TABLE "events" ADD COLUMN     "referrer_event_id" UUID;

-- CreateIndex
CREATE INDEX "events_referrer_event_id_idx" ON "events"("referrer_event_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_referrer_event_id_fkey" FOREIGN KEY ("referrer_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
