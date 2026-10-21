CREATE TYPE "LoginChallengeChannel" AS ENUM ('VOICE', 'EMAIL');
CREATE TYPE "LoginChallengePurpose" AS ENUM ('MEMBER', 'ADMIN');

CREATE TABLE "login_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" "LoginChallengePurpose" NOT NULL,
    "channel" "LoginChallengeChannel" NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_challenges_code_hash_key" ON "login_challenges"("code_hash");
CREATE INDEX "login_challenges_user_id_idx" ON "login_challenges"("user_id");

ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
