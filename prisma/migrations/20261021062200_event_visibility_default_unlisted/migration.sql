-- 新規イベントの既定を紹介制（ホーム非掲載）にする。既存行の visibility は変えない。
ALTER TABLE "events" ALTER COLUMN "visibility" SET DEFAULT 'UNLISTED';
