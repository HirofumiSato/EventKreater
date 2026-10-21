-- 確認済みの電話番号だけを users に置く。未確認は NULL のままなので、一意制約は確認後の番号にだけ効く。
ALTER TABLE "users" ADD COLUMN "phone_e164" VARCHAR(20);
ALTER TABLE "users" ADD COLUMN "phone_verified_at" TIMESTAMPTZ;
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users"("phone_e164");

CREATE TABLE "signup_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(255),
    "google_sub" VARCHAR(255),
    "email_verified_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_intents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signup_intents_email_idx" ON "signup_intents"("email");

ALTER TABLE "email_verification_tokens" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "email_verification_tokens" ADD COLUMN "signup_intent_id" UUID;
CREATE INDEX "email_verification_tokens_signup_intent_id_idx" ON "email_verification_tokens"("signup_intent_id");

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_signup_intent_id_fkey" FOREIGN KEY ("signup_intent_id") REFERENCES "signup_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_subject_check" CHECK ("user_id" IS NOT NULL OR "signup_intent_id" IS NOT NULL);

CREATE TABLE "phone_verification_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_e164" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "signup_intent_id" UUID,
    "user_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phone_verification_codes_code_hash_key" ON "phone_verification_codes"("code_hash");
CREATE INDEX "phone_verification_codes_phone_e164_idx" ON "phone_verification_codes"("phone_e164");
CREATE INDEX "phone_verification_codes_signup_intent_id_idx" ON "phone_verification_codes"("signup_intent_id");
CREATE INDEX "phone_verification_codes_user_id_idx" ON "phone_verification_codes"("user_id");

ALTER TABLE "phone_verification_codes" ADD CONSTRAINT "phone_verification_codes_signup_intent_id_fkey" FOREIGN KEY ("signup_intent_id") REFERENCES "signup_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phone_verification_codes" ADD CONSTRAINT "phone_verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phone_verification_codes" ADD CONSTRAINT "phone_verification_codes_subject_check" CHECK ("user_id" IS NOT NULL OR "signup_intent_id" IS NOT NULL);
