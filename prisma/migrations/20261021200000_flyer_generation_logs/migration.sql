-- CreateTable
CREATE TABLE "flyer_generation_logs" (
    "id" UUID NOT NULL,
    "draft_key" UUID NOT NULL,
    "user_id" UUID,
    "owner_token_hash" VARCHAR(64),
    "template_id" VARCHAR(40) NOT NULL,
    "layout_id" VARCHAR(40) NOT NULL,
    "palette_id" VARCHAR(32) NOT NULL,
    "flyer_asset_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flyer_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flyer_generation_logs_draft_key_created_at_idx" ON "flyer_generation_logs"("draft_key", "created_at");

-- CreateIndex
CREATE INDEX "flyer_generation_logs_owner_token_hash_created_at_idx" ON "flyer_generation_logs"("owner_token_hash", "created_at");

-- CreateIndex
CREATE INDEX "flyer_generation_logs_user_id_created_at_idx" ON "flyer_generation_logs"("user_id", "created_at");
