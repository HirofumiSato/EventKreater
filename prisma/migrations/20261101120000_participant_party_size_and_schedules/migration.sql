-- AlterTable
ALTER TABLE "participants" ADD COLUMN "party_size" INTEGER NOT NULL DEFAULT 1;

-- 自分を含む人数。0 人や負の人数は定義できない。
ALTER TABLE "participants" ADD CONSTRAINT "participants_party_size_check" CHECK ("party_size" >= 1);

-- CreateTable
CREATE TABLE "participant_schedules" (
    "participant_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,

    CONSTRAINT "participant_schedules_pkey" PRIMARY KEY ("participant_id", "schedule_id")
);

-- CreateIndex
CREATE INDEX "participant_schedules_schedule_id_idx" ON "participant_schedules"("schedule_id");

-- AddForeignKey
ALTER TABLE "participant_schedules" ADD CONSTRAINT "participant_schedules_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_schedules" ADD CONSTRAINT "participant_schedules_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "event_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存の 1 件だけの日程を、複数日程の表へ写す。
INSERT INTO "participant_schedules" ("participant_id", "schedule_id")
SELECT "id", "schedule_id" FROM "participants" WHERE "schedule_id" IS NOT NULL;
