-- 会員の公開プロフィール。行が無い会員は「未作成（非公開）」として扱う。
-- ページ自体は誰でも開けるため、バックフィルは要らない。
CREATE TABLE "organizer_profiles" (
    "user_id" UUID NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "headline" VARCHAR(60),
    "bio" VARCHAR(400),
    "area" VARCHAR(50),
    "tags" TEXT[],
    "x_url" VARCHAR(200),
    "instagram_url" VARCHAR(200),
    "website_url" VARCHAR(200),
    "line_url" VARCHAR(200),
    "show_stats" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizer_profiles_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "organizer_profiles"
    ADD CONSTRAINT "organizer_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
