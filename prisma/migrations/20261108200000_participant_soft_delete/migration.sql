-- 名簿から外した日時。NULL は有効。
-- 幹事が名簿から削除しても行は残し、名簿の末尾に薄く出す（元に戻せる）。
ALTER TABLE "participants" ADD COLUMN "deleted_at" TIMESTAMPTZ;

-- 名簿は未削除の行だけを催しごとに引くため。
CREATE INDEX "participants_event_id_deleted_at_idx" ON "participants"("event_id", "deleted_at");
