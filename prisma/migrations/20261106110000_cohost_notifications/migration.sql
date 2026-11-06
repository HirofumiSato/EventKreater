-- 共同主催の受諾・解除を、幹事へ知らせるアプリ内通知。
-- メールは送らない。文面は作成時点で確定して保存する（列の追加は要らない）。

ALTER TYPE "NotificationKind" ADD VALUE 'COHOST_JOINED';
ALTER TYPE "NotificationKind" ADD VALUE 'COHOST_REMOVED';
