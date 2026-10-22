-- ゲスト幹事の公開表示名。会員は User.name を都度参照するため NULL のまま。
ALTER TABLE "event_organizers" ADD COLUMN "display_name" VARCHAR(50);

-- 1イベント1オーナーを保証する前に、既存データを直す。
-- 複数 OWNER があるイベントは、最初に作られた1行だけを OWNER に残し、残りを CO_HOST へ下げる。
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "event_id" ORDER BY "created_at" ASC, "id" ASC) AS rn
  FROM "event_organizers"
  WHERE "role" = 'OWNER'
)
UPDATE "event_organizers" AS eo
SET "role" = 'CO_HOST'
FROM ranked
WHERE eo."id" = ranked."id" AND ranked.rn > 1;

-- OWNER が居ないイベントは、最初に作られた幹事行を OWNER にする。
WITH missing AS (
  SELECT "event_id"
  FROM "event_organizers"
  GROUP BY "event_id"
  HAVING COUNT(*) FILTER (WHERE "role" = 'OWNER') = 0
),
first_row AS (
  SELECT
    eo."id",
    ROW_NUMBER() OVER (PARTITION BY eo."event_id" ORDER BY eo."created_at" ASC, eo."id" ASC) AS rn
  FROM "event_organizers" eo
  JOIN missing ON missing."event_id" = eo."event_id"
)
UPDATE "event_organizers" AS eo
SET "role" = 'OWNER'
FROM first_row
WHERE eo."id" = first_row."id" AND first_row.rn = 1;

-- 部分ユニーク索引。Prisma のスキーマでは表現できないため、生 SQL で作る。
CREATE UNIQUE INDEX "event_organizers_one_owner"
  ON "event_organizers" ("event_id")
  WHERE "role" = 'OWNER';
