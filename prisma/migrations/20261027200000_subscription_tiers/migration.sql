-- 定額プランを「月8回まで 980円」と「作り放題 2980円」の2段階にする。
-- 既存の 980 円加入者は、加入時に約束した無制限をそのまま引き継ぐ（UNLIMITED）。

CREATE TYPE "SubscriptionPlan" AS ENUM ('NONE', 'MONTHLY_8', 'UNLIMITED');

-- キャンペーンの対象に、プランごとの指定を足す。
-- SUBSCRIPTION は「定額プランの両方」の意味のまま残す（既存の行を書き換えない）。
ALTER TYPE "PricingTarget" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_8';
ALTER TYPE "PricingTarget" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_UNLIMITED';

ALTER TABLE "user_usage_quotas"
  ADD COLUMN "subscription_plan" "SubscriptionPlan" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "monthly_event_count" SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN "monthly_period_key" VARCHAR(7);

-- 加入中の会員は、当時の約束（回数を数えない）を引き継ぐ。
UPDATE "user_usage_quotas"
SET "subscription_plan" = 'UNLIMITED'
WHERE "subscription_status" = 'ACTIVE';

-- クーポンはプランごとに金額が違うので、一意キーへプランを足す。
ALTER TABLE "pricing_campaign_coupons"
  ADD COLUMN "plan" "SubscriptionPlan" NOT NULL DEFAULT 'MONTHLY_8';

DROP INDEX "pricing_campaign_coupons_campaign_id_version_months_kind_key";
CREATE UNIQUE INDEX "pricing_campaign_coupons_campaign_id_version_months_kind_plan_key"
  ON "pricing_campaign_coupons"("campaign_id", "version", "months", "kind", "plan");
