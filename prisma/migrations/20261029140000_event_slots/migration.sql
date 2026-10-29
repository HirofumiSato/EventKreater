-- 月額プランの数え方を「暦月に何回作ったか」から「公開中のイベントが何件あるか」へ変える。
-- 暦月のカウンタは要らなくなるので落とし、代わりにイベントがどの枠から公開されたかを持つ。

CREATE TYPE "QuotaSource" AS ENUM ('FREE_TRIAL', 'PAID_CREDIT', 'SUBSCRIPTION');

ALTER TABLE "events"
  ADD COLUMN "quota_source" "QuotaSource";

-- 既存のイベントを、公開したときの枠へ割り当てる。
-- オーナーが定額プランに加入していれば SUBSCRIPTION（＝公開中の件数に数える）、
-- そうでなければ単発クレジット扱いにして数えない。無料枠の履歴は判別できないため PAID_CREDIT に寄せる。
-- 下書きは公開時に割り当てるので触らない。
UPDATE "events" AS e
SET "quota_source" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "event_organizers" AS o
    JOIN "user_usage_quotas" AS q ON q."user_id" = o."user_id"
    WHERE o."event_id" = e."id"
      AND o."role" = 'OWNER'
      AND q."subscription_status" = 'ACTIVE'
  ) THEN 'SUBSCRIPTION'::"QuotaSource"
  ELSE 'PAID_CREDIT'::"QuotaSource"
END
WHERE e."status" <> 'DRAFT'
  AND e."is_deleted" = false;

-- 利用枠の暦月カウンタを落とす。回数の判定は公開中のイベントを数えて行う。
ALTER TABLE "user_usage_quotas"
  DROP COLUMN "monthly_event_count",
  DROP COLUMN "monthly_period_key";

-- 公開中のイベントを数える問い合わせ（オーナー × 状態 × 開催日）を軽くする。
CREATE INDEX "events_quota_source_status_is_deleted_idx"
  ON "events"("quota_source", "status", "is_deleted");
