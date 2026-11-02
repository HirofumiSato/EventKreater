-- 期限つきの無料1回分。残数を列に持たず、1枚1行で持つ。
-- `user_usage_quotas.paid_credits` と混ぜない。あの列は期限を持てないので、
-- 7日の券と3か月の券を同じ残高に入れると、どちらが先に消えるかを表せない。
CREATE TYPE "FreeTicketSource" AS ENUM ('AD', 'REFERRAL', 'MANUAL');

CREATE TABLE "free_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "FreeTicketSource" NOT NULL,
    "granted_by_user_id" UUID,
    "reason_key" VARCHAR(255),
    "provider" VARCHAR(50),
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "event_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "free_tickets_pkey" PRIMARY KEY ("id")
);

-- 二重付与を止める。同じ理由（例: referral:<新規userId>）で2枚目を作らせない。
CREATE UNIQUE INDEX "free_tickets_reason_key_key" ON "free_tickets"("reason_key");

-- 残数の数え上げと、期限が近い券の選択。
CREATE INDEX "free_tickets_user_id_used_at_expires_at_idx" ON "free_tickets"("user_id", "used_at", "expires_at");

-- 紹介の生涯上限（紹介者ごと・種別ごとの件数）。
CREATE INDEX "free_tickets_granted_by_user_id_source_idx" ON "free_tickets"("granted_by_user_id", "source");

-- 期限切れの掃除と、配布の監視。
CREATE INDEX "free_tickets_expires_at_idx" ON "free_tickets"("expires_at");

ALTER TABLE "free_tickets"
    ADD CONSTRAINT "free_tickets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "free_tickets"
    ADD CONSTRAINT "free_tickets_granted_by_user_id_fkey"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 紹介のコードと、誰の紹介で登録したか。既存行は NULL のままで、
-- コードは初めて紹介画面を開いたときに作る（バックフィルしない）。
ALTER TABLE "users"
    ADD COLUMN "referral_code" VARCHAR(12),
    ADD COLUMN "referred_by_user_id" UUID;

CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- 登録意向にもコードを持たせる。`beginSignupIntent` は毎回作り直すので、
-- 呼び出し側が登録のたびに渡し直す。
ALTER TABLE "signup_intents"
    ADD COLUMN "referral_code" VARCHAR(12);
