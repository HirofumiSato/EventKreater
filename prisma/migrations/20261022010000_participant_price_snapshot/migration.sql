-- 参加者に、出欠確定時点の費用プラン金額・プラン名・対象のスナップショットを持たせる。
-- 見込み売上を「プラン金額 × 出席人数」で出せるようにするが、プラン金額や名前を
-- 後から編集しても過去の売上が遡って変わらないように、値は写しで持つ。
ALTER TABLE "participants" ADD COLUMN     "price_amount" INTEGER;
ALTER TABLE "participants" ADD COLUMN     "price_plan_name" VARCHAR(50);
ALTER TABLE "participants" ADD COLUMN     "price_audience" "PriceAudience";

-- 既存の出席者には、いま紐づいているプランの値を写す。
-- プラン行が既に消えて price_plan_id が NULL（onDelete: SetNull）の行は復元できないため、
-- プラン未選択として NULL のまま残す。
UPDATE "participants" p
SET "price_amount"    = pl."amount",
    "price_plan_name" = pl."name",
    "price_audience"  = pl."audience"
FROM "event_price_plans" pl
WHERE p."price_plan_id" = pl."id"
  AND p."status" = 'ATTENDING';

-- 横断の売上集計は event_id と status で絞って price_amount を足すだけなので、
-- 既存の (event_id, status) インデックスで足りる。
