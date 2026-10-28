-- 会員の画像実体。プロフィールのアイコンに使い、将来のイベント表紙でも同じ表を使う。
-- 参照する側に外部キーを置くので、用途（kind）が増えてもこの表は変えない。
CREATE TABLE "image_assets" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "image_assets_user_id_is_deleted_idx" ON "image_assets"("user_id", "is_deleted");

ALTER TABLE "image_assets"
    ADD CONSTRAINT "image_assets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- プロフィールのアイコン参照と、公開ページのテーマ。
-- theme_id は列挙型にしない。テーマを増やすたびにマイグレーションが要るため。
ALTER TABLE "organizer_profiles"
    ADD COLUMN "avatar_image_id" UUID,
    ADD COLUMN "theme_id" VARCHAR(32);

CREATE UNIQUE INDEX "organizer_profiles_avatar_image_id_key"
    ON "organizer_profiles"("avatar_image_id");

ALTER TABLE "organizer_profiles"
    ADD CONSTRAINT "organizer_profiles_avatar_image_id_fkey"
    FOREIGN KEY ("avatar_image_id") REFERENCES "image_assets"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
