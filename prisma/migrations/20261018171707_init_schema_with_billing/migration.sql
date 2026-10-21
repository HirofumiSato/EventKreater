-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('ONE_TIME', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RainPolicy" AS ENUM ('RAIN_OR_SHINE', 'CANCEL_ON_RAIN', 'POSTPONE_ON_RAIN', 'INDOOR');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrganizerRole" AS ENUM ('OWNER', 'CO_HOST');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('ATTENDING', 'DECLINED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_usage_quotas" (
    "user_id" UUID NOT NULL,
    "free_event_count" SMALLINT NOT NULL DEFAULT 0,
    "paid_credits" INTEGER NOT NULL DEFAULT 0,
    "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "current_period_end" TIMESTAMPTZ,
    "stripe_customer_id" VARCHAR(255),
    "stripe_subscription_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_usage_quotas_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "billing_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payment_type" "PaymentType" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'jpy',
    "stripe_checkout_session_id" VARCHAR(255),
    "stripe_payment_intent_id" VARCHAR(255),
    "stripe_invoice_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "stripe_event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(255) NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("stripe_event_id")
);

-- CreateTable
CREATE TABLE "flyer_assets" (
    "id" UUID NOT NULL,
    "external_flyer_id" VARCHAR(100),
    "image_url" TEXT NOT NULL,
    "lqip_data_url" TEXT,
    "aspect_ratio" VARCHAR(10) NOT NULL DEFAULT '9:16',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flyer_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "event_date" DATE NOT NULL,
    "event_time" VARCHAR(50) NOT NULL,
    "price" VARCHAR(50) NOT NULL,
    "location" VARCHAR(150) NOT NULL,
    "rain_policy" "RainPolicy" NOT NULL DEFAULT 'RAIN_OR_SHINE',
    "capacity" INTEGER,
    "flyer_asset_id" UUID,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_organizers" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID,
    "guest_token_hash" VARCHAR(64),
    "role" "OrganizerRole" NOT NULL DEFAULT 'CO_HOST',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_organizers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID,
    "rsvp_token_hash" VARCHAR(64) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "status" "RsvpStatus" NOT NULL,
    "comment" TEXT,
    "ip_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_locks" (
    "event_id" UUID NOT NULL,
    "locked_by_user_id" UUID,
    "locked_by_token_hash" VARCHAR(64),
    "lock_holder_name" VARCHAR(50) NOT NULL,
    "lock_token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "event_locks_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_invitations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "invite_code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_usage_quotas_stripe_customer_id_key" ON "user_usage_quotas"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_usage_quotas_stripe_subscription_id_key" ON "user_usage_quotas"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "user_usage_quotas_stripe_customer_id_idx" ON "user_usage_quotas"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "user_usage_quotas_stripe_subscription_id_idx" ON "user_usage_quotas"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_transactions_stripe_checkout_session_id_key" ON "billing_transactions"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_transactions_stripe_payment_intent_id_key" ON "billing_transactions"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "billing_transactions_user_id_idx" ON "billing_transactions"("user_id");

-- CreateIndex
CREATE INDEX "billing_transactions_stripe_checkout_session_id_idx" ON "billing_transactions"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "events_status_is_deleted_event_date_idx" ON "events"("status", "is_deleted", "event_date");

-- CreateIndex
CREATE UNIQUE INDEX "event_organizers_guest_token_hash_key" ON "event_organizers"("guest_token_hash");

-- CreateIndex
CREATE INDEX "event_organizers_user_id_idx" ON "event_organizers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_organizers_event_id_user_id_key" ON "event_organizers"("event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_rsvp_token_hash_key" ON "participants"("rsvp_token_hash");

-- CreateIndex
CREATE INDEX "participants_event_id_status_idx" ON "participants"("event_id", "status");

-- CreateIndex
CREATE INDEX "participants_user_id_idx" ON "participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_locks_lock_token_hash_key" ON "event_locks"("lock_token_hash");

-- CreateIndex
CREATE INDEX "event_locks_expires_at_idx" ON "event_locks"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_invitations_invite_code_hash_key" ON "event_invitations"("invite_code_hash");

-- CreateIndex
CREATE INDEX "event_invitations_event_id_is_revoked_expires_at_idx" ON "event_invitations"("event_id", "is_revoked", "expires_at");

-- AddForeignKey
ALTER TABLE "user_usage_quotas" ADD CONSTRAINT "user_usage_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_flyer_asset_id_fkey" FOREIGN KEY ("flyer_asset_id") REFERENCES "flyer_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_organizers" ADD CONSTRAINT "event_organizers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_organizers" ADD CONSTRAINT "event_organizers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_locks" ADD CONSTRAINT "event_locks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_locks" ADD CONSTRAINT "event_locks_locked_by_user_id_fkey" FOREIGN KEY ("locked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
