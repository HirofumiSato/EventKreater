-- 生成した候補の ID。保存時に flyer_asset_id を結び、同じ候補の二重保存を防ぐ。
ALTER TABLE "flyer_generation_logs" ADD COLUMN "candidate_id" VARCHAR(64);

-- 背景の供給元。既存行は AI の生成として扱い、使った回数をそのまま引き継ぐ。
ALTER TABLE "flyer_generation_logs" ADD COLUMN "source" VARCHAR(16) NOT NULL DEFAULT 'ai';

-- 下書き ID は廃止。新規行は NULL で残し、旧クライアントの履歴だけを残す。
ALTER TABLE "flyer_generation_logs" ALTER COLUMN "draft_key" DROP NOT NULL;

-- 保存時に候補から生成履歴を引くため。
CREATE INDEX "flyer_generation_logs_candidate_id_idx" ON "flyer_generation_logs"("candidate_id");
