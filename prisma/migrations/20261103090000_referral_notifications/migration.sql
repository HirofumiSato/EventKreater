-- 紹介でチケットが配られたことを、紹介者へ知らせる通知。
-- この通知は催しに紐づかないので、`notifications.event_id` を NULL 可にする。

ALTER TYPE "NotificationKind" ADD VALUE 'REFERRAL_GRANTED';

-- 紹介の通知は催しを持たない。外部キーはそのままで、NULL を許すだけ。
ALTER TABLE "notifications" ALTER COLUMN "event_id" DROP NOT NULL;
