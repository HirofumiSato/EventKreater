-- 価格キャンペーン（0円販売・期間限定割引）と、0円月額の終了前案内。

CREATE TYPE "PricingTarget" AS ENUM ('ONE_TIME', 'SUBSCRIPTION', 'BOTH');
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FREE');
CREATE TYPE "BillingNoticeKind" AS ENUM ('FREE_PERIOD_ENDING_3D', 'FREE_PERIOD_ENDING_1D');

-- 会計記録に定価・割引額・適用キャンペーンを残す。
ALTER TABLE "billing_transactions"
  ADD COLUMN "list_amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discount_amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "campaign_id" UUID,
  ADD COLUMN "applied_percent" SMALLINT,
  ADD COLUMN "stripe_coupon_id" VARCHAR(255),
  ADD COLUMN "request_key" VARCHAR(255);

UPDATE "billing_transactions"
SET "list_amount" = "amount"
WHERE "amount" > 0;

-- 適用中の割引と、その終了日時。0円月額の事前案内はここを基準にする。
ALTER TABLE "user_usage_quotas"
  ADD COLUMN "pricing_campaign_id" UUID,
  ADD COLUMN "discount_ends_at" TIMESTAMPTZ,
  ADD COLUMN "discount_percent" SMALLINT;

CREATE TABLE "pricing_campaigns" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "target" "PricingTarget" NOT NULL,
  "discount_kind" "DiscountKind" NOT NULL,
  "percent" SMALLINT NOT NULL,
  "starts_at" TIMESTAMPTZ NOT NULL,
  "ends_at" TIMESTAMPTZ NOT NULL,
  "priority" SMALLINT NOT NULL DEFAULT 0,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "free_per_user_limit" SMALLINT NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID,
  "stopped_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "pricing_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_campaign_coupons" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "months" SMALLINT NOT NULL,
  "kind" "DiscountKind" NOT NULL,
  "stripe_coupon_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_campaign_coupons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_campaign_audits" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" VARCHAR(20) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_campaign_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_notices" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "campaign_id" UUID,
  "kind" "BillingNoticeKind" NOT NULL,
  "period_end" TIMESTAMPTZ NOT NULL,
  "recipient_email" VARCHAR(255) NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "body" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_notices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_transactions_request_key_key" ON "billing_transactions"("request_key");
CREATE INDEX "billing_transactions_campaign_id_user_id_payment_type_payment_status_idx"
  ON "billing_transactions"("campaign_id", "user_id", "payment_type", "payment_status");
CREATE INDEX "user_usage_quotas_discount_ends_at_idx" ON "user_usage_quotas"("discount_ends_at");
CREATE INDEX "pricing_campaigns_target_is_enabled_starts_at_ends_at_priority_idx"
  ON "pricing_campaigns"("target", "is_enabled", "starts_at", "ends_at", "priority");
CREATE UNIQUE INDEX "pricing_campaign_coupons_campaign_id_version_months_kind_key"
  ON "pricing_campaign_coupons"("campaign_id", "version", "months", "kind");
CREATE UNIQUE INDEX "pricing_campaign_coupons_stripe_coupon_id_key"
  ON "pricing_campaign_coupons"("stripe_coupon_id");
CREATE INDEX "pricing_campaign_audits_campaign_id_created_at_idx"
  ON "pricing_campaign_audits"("campaign_id", "created_at");
CREATE UNIQUE INDEX "billing_notices_user_id_kind_period_end_key"
  ON "billing_notices"("user_id", "kind", "period_end");
CREATE INDEX "billing_notices_created_at_idx" ON "billing_notices"("created_at");

ALTER TABLE "billing_transactions"
  ADD CONSTRAINT "billing_transactions_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "pricing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_usage_quotas"
  ADD CONSTRAINT "user_usage_quotas_pricing_campaign_id_fkey"
  FOREIGN KEY ("pricing_campaign_id") REFERENCES "pricing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pricing_campaigns"
  ADD CONSTRAINT "pricing_campaigns_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pricing_campaign_coupons"
  ADD CONSTRAINT "pricing_campaign_coupons_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "pricing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pricing_campaign_audits"
  ADD CONSTRAINT "pricing_campaign_audits_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "pricing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_notices"
  ADD CONSTRAINT "billing_notices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_notices"
  ADD CONSTRAINT "billing_notices_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "pricing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
