-- 運営が付与する公開し放題（無制限）。Stripe の契約とは別の列で持ち、
-- Webhook の更新（解約・支払い失敗）では消さない。解除するまで有効で、期限は持たない。
-- enum は既存の "SubscriptionPlan" を使い、新種別は増やさない。
ALTER TABLE "user_usage_quotas"
    ADD COLUMN "granted_plan" "SubscriptionPlan",
    ADD COLUMN "granted_plan_by" UUID,
    ADD COLUMN "granted_plan_at" TIMESTAMPTZ;

-- 誰が付与したかを辿る。管理者が退会しても付与の事実は残し、参照だけ外す。
ALTER TABLE "user_usage_quotas"
    ADD CONSTRAINT "user_usage_quotas_granted_plan_by_fkey"
    FOREIGN KEY ("granted_plan_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
