-- 月額プランの初月無料（Stripe のネイティブトライアル）で使う列。
-- trial_ends_at は trialing のあいだだけ値を持ち、trial_used_at は再加入で繰り返さない印。
-- 既存行はどちらも NULL のままで、いまの請求には影響しない。
ALTER TABLE "user_usage_quotas"
    ADD COLUMN "trial_ends_at" TIMESTAMPTZ,
    ADD COLUMN "trial_used_at" TIMESTAMPTZ;

-- 3日前・1日前の案内は、無料期間の終わりを毎日1回だけ引く。
CREATE INDEX "user_usage_quotas_trial_ends_at_idx"
    ON "user_usage_quotas"("trial_ends_at");

-- 0円の初回請求を、通常のクーポンによる割引と区別する。
ALTER TABLE "billing_transactions"
    ADD COLUMN "trial_applied" BOOLEAN NOT NULL DEFAULT false;
