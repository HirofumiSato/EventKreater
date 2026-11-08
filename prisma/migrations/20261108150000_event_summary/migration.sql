-- 公開ページ冒頭の概要。許可タグだけの HTML で、表示文字数は 200 字まで。
-- 既存イベントは NULL（概要なし）のまま。

ALTER TABLE "events" ADD COLUMN "summary" TEXT;
