-- ホームのイベント一覧・検索を廃止する。
-- 掲載フラグ（visibility）は将来のメディアサイト用に列とインデックスを残すが、
-- 既存の PUBLIC は紹介制へ寄せ、意図しない一覧露出をなくす。
UPDATE "events" SET "visibility" = 'UNLISTED' WHERE "visibility" = 'PUBLIC';
