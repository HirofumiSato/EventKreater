-- 共同主催の売上按分。イベントごとの設定と、主催者1人ぶんの配分を持つ。
CREATE TYPE "RevenueSplitMode" AS ENUM ('RATIO', 'HEADCOUNT');
CREATE TYPE "RevenueShareVisibility" AS ENUM ('ALL', 'OWN_ONLY');

CREATE TABLE "event_revenue_settings" (
  "event_id" UUID NOT NULL,
  "mode" "RevenueSplitMode" NOT NULL DEFAULT 'RATIO',
  "visibility" "RevenueShareVisibility" NOT NULL DEFAULT 'OWN_ONLY',
  "updated_by_user_id" UUID,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "event_revenue_settings_pkey" PRIMARY KEY ("event_id")
);

CREATE TABLE "event_revenue_shares" (
  "organizer_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "share_bps" INTEGER,
  "headcount" INTEGER,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "event_revenue_shares_pkey" PRIMARY KEY ("organizer_id")
);

CREATE INDEX "event_revenue_shares_event_id_idx" ON "event_revenue_shares" ("event_id");

ALTER TABLE "event_revenue_settings"
  ADD CONSTRAINT "event_revenue_settings_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_revenue_shares"
  ADD CONSTRAINT "event_revenue_shares_organizer_id_fkey"
  FOREIGN KEY ("organizer_id") REFERENCES "event_organizers" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_revenue_shares"
  ADD CONSTRAINT "event_revenue_shares_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
