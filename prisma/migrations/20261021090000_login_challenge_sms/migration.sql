-- ログイン確認番号の届け方を音声通話からSMSへ変更する。
ALTER TYPE "LoginChallengeChannel" RENAME TO "LoginChallengeChannel_old";
CREATE TYPE "LoginChallengeChannel" AS ENUM ('SMS', 'EMAIL');
ALTER TABLE "login_challenges"
    ALTER COLUMN "channel" TYPE "LoginChallengeChannel"
    USING (CASE WHEN "channel"::text = 'VOICE' THEN 'SMS' ELSE "channel"::text END)::"LoginChallengeChannel";
DROP TYPE "LoginChallengeChannel_old";
