-- 公開プロフィールの先頭に敷く横長の画像（3:1）。
-- アイコンと同じく、参照する側に外部キーを置く。画像の実体は image_assets に持つ。
-- 既存行は NULL のままで、ヘッダー無しの見た目は変わらない。
ALTER TABLE "organizer_profiles"
    ADD COLUMN "header_image_id" UUID;

CREATE UNIQUE INDEX "organizer_profiles_header_image_id_key"
    ON "organizer_profiles"("header_image_id");

ALTER TABLE "organizer_profiles"
    ADD CONSTRAINT "organizer_profiles_header_image_id_fkey"
    FOREIGN KEY ("header_image_id") REFERENCES "image_assets"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
