-- 付与の種別。granted_plan が「何を付与したか」（UNLIMITED）を持つに対し、
-- granted_kind は「なぜ付与したか」（運営付与 / 営業デモ）を持つ。
-- 公開可否の判定はどちらも既存の granted_plan の 1 本で、種別は表示と管理画面の操作だけに使う。
CREATE TYPE "QuotaGrantKind" AS ENUM ('OPERATOR', 'DEMO');

ALTER TABLE "user_usage_quotas"
    ADD COLUMN "granted_kind" "QuotaGrantKind";

-- 種別を足す前の付与は、すべて運営付与として埋める。
-- 以後、granted_kind が NULL の行は OPERATOR として扱う（コード側の grantKindOf も同じ）。
UPDATE "user_usage_quotas"
SET "granted_kind" = 'OPERATOR'
WHERE "granted_plan" IS NOT NULL
  AND "granted_kind" IS NULL;
