-- CreateEnum
CREATE TYPE "AccountChangeKind" AS ENUM ('NAME', 'EMAIL', 'PHONE', 'PASSWORD', 'WITHDRAW', 'REACTIVATE');

-- DropForeignKey
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_event_id_fkey";

-- DropForeignKey
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_participant_id_fkey";

-- DropIndex
DROP INDEX "participants_user_id_idx";

-- AlterTable
ALTER TABLE "auth_attempts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "auth_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "email_verification_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "login_challenges" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "phone_verification_codes" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "receipts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "signup_intents" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "account_change_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "kind" "AccountChangeKind" NOT NULL,
    "before_value" VARCHAR(255),
    "after_value" VARCHAR(255),
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_change_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "new_email" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_change_logs_user_id_created_at_idx" ON "account_change_logs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_change_requests_token_hash_key" ON "email_change_requests"("token_hash");

-- CreateIndex
CREATE INDEX "email_change_requests_user_id_idx" ON "email_change_requests"("user_id");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- AddForeignKey
ALTER TABLE "account_change_logs" ADD CONSTRAINT "account_change_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "billing_transactions_campaign_id_user_id_payment_type_payment_s" RENAME TO "billing_transactions_campaign_id_user_id_payment_type_payme_idx";

-- RenameIndex
ALTER INDEX "pricing_campaigns_target_is_enabled_starts_at_ends_at_priority_" RENAME TO "pricing_campaigns_target_is_enabled_starts_at_ends_at_prior_idx";

-- RenameIndex
ALTER INDEX "idx_receipts_event" RENAME TO "receipts_event_id_idx";
