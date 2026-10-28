-- 告知ページの対象世代と、セマンティックテーマ。
-- どちらも任意。NULL のままの既存イベントは、いまの DOM と見た目を変えない。
-- theme_id は列挙型にしない。テーマを増やすたびにマイグレーションが要るため
-- （一覧の正は src/lib/semantic-themes.ts）。
ALTER TABLE "events"
    ADD COLUMN "target_generation" VARCHAR(50),
    ADD COLUMN "theme_id" VARCHAR(32);
