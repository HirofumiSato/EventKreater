-- 過去に入力した会場を、作成画面の「過去の会場から選ぶ」に出す。
-- 会員は `u:<user_id>`、未登録の幹事は `d:<端末トークンのsha256>` を owner_key に持つ。
-- owner_key と指紋の組で一意にし、同じ会場を再入力しても行を増やさない。
CREATE TABLE "venue_suggestions" (
    "id" UUID NOT NULL,
    "owner_key" VARCHAR(80) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "venue_name" VARCHAR(150),
    "postal_code" VARCHAR(7),
    "prefecture" VARCHAR(20),
    "city" VARCHAR(100),
    "town" VARCHAR(100),
    "address_line" VARCHAR(200),
    "building" VARCHAR(150),
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "venue_suggestions_owner_key_fingerprint_key" ON "venue_suggestions"("owner_key", "fingerprint");

-- CreateIndex
CREATE INDEX "venue_suggestions_owner_key_last_used_at_idx" ON "venue_suggestions"("owner_key", "last_used_at");
