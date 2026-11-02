-- 参加費を受け取った日時。NULL は未集金。
-- 領収書の画面を外した代わりに、幹事が名簿で 1 タップして記録する。
ALTER TABLE "participants"
    ADD COLUMN "collected_at" TIMESTAMPTZ;

-- 旧・領収書の発行日を集金日として引き継ぐ（紙は消えるが、集計は動かさない）。
UPDATE "participants" AS p
SET "collected_at" = r."issued_at"
FROM "receipts" AS r
WHERE r."participant_id" = p."id" AND p."status" = 'ATTENDING';
