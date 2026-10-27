-- チラシの基準比率を 9:16（SNS 縦長）から A4 縦へ変える。
-- 既存行は当時の画像の実比率を表しているので書き換えない。既定値だけを変える。
ALTER TABLE "flyer_assets" ALTER COLUMN "aspect_ratio" SET DEFAULT 'A4';
