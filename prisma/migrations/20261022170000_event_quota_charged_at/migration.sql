-- 下書きの作成時に利用枠を消費したかどうかを持つ。
-- 複製は作成時に消費する（既存の課金仕様）。新規作成の 402 から作る下書きは消費しないため、
-- 公開時に二重課金しないよう「消費済み」を明示する。
ALTER TABLE "events" ADD COLUMN "quota_charged_at" TIMESTAMPTZ;

-- この列を足す前に存在する下書きは、すべて複製が作成したもの（作成時に消費済み）。
UPDATE "events" SET "quota_charged_at" = "created_at" WHERE "status" = 'DRAFT';
