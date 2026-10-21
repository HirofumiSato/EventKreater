/**
 * 旧形式のイベントデータを新しい列へ移す。
 *
 * 対象:
 *  - event_schedules.event_time（自由文）→ start_time / end_time
 *  - event_price_plans.price（自由文）→ amount / note
 *
 * 何度実行しても安全（start_time が NULL の行、amount が 0 で price が残っている行だけを見る）。
 * 解析できない行は触らず、最後に一覧を出す。手で直してから再実行する。
 *
 * 使い方: npm run db:backfill
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** serializers.ts の parseLegacyEventTime と同じ規則。スクリプトは TS を読めないため複製する。 */
function parseLegacyEventTime(source) {
  const normalized = source
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[〜~～ー–—−]/g, "-")
    .replace(/翌日?/g, "")
    .replace(/\s/g, "");
  const matched = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(normalized);
  if (!matched) return null;
  const startTime = matched[1].padStart(5, "0");
  const endTime = matched[2].padStart(5, "0");
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) return null;
  if (startTime === endTime) return null;
  return { startTime, endTime };
}

/** serializers.ts の parseLegacyPrice と同じ規則。 */
function parseLegacyPrice(source) {
  const text = source.trim();
  const matched = /([0-9][0-9,]*)\s*円/.exec(text);
  const amount = matched ? Number(matched[1].replace(/,/g, "")) : 0;
  const parenthesized = /[（(]([^）)]*)[）)]/.exec(text);
  const note = parenthesized?.[1]?.trim() || null;
  return { amount: Number.isFinite(amount) ? amount : 0, note };
}

async function backfillSchedules() {
  const rows = await prisma.$queryRaw`
    SELECT "id", "event_time"
    FROM "event_schedules"
    WHERE "start_time" IS NULL
       OR "end_time" IS NULL
       OR "event_time" IS DISTINCT FROM (
         CASE
           WHEN "end_time" < "start_time" THEN "start_time" || '〜翌' || "end_time"
           ELSE "start_time" || '〜' || "end_time"
         END
       )
  `;
  let updated = 0;
  const unresolved = [];
  for (const row of rows) {
    const parsed = parseLegacyEventTime(row.event_time ?? "");
    if (!parsed) {
      unresolved.push({ id: row.id, eventTime: row.event_time });
      continue;
    }
    // 表示用の event_time も新しい形式（19:00〜21:30 / 22:00〜翌02:00）に揃える。
    const eventTime =
      parsed.endTime < parsed.startTime
        ? `${parsed.startTime}〜翌${parsed.endTime}`
        : `${parsed.startTime}〜${parsed.endTime}`;
    await prisma.$executeRaw`
      UPDATE "event_schedules"
      SET "start_time" = ${parsed.startTime},
          "end_time" = ${parsed.endTime},
          "event_time" = ${eventTime}
      WHERE "id" = ${row.id}::uuid
    `;
    updated += 1;
  }
  return { updated, unresolved };
}

async function backfillPrices() {
  const rows = await prisma.$queryRaw`
    SELECT "id", "price", "amount", "note"
    FROM "event_price_plans"
    WHERE "price" IS NOT NULL
  `;
  let updated = 0;
  const ambiguous = [];
  for (const row of rows) {
    const legacy = (row.price ?? "").trim();
    if (!legacy) continue;
    const parsed = parseLegacyPrice(legacy);
    // 旧データが男女複合（例: 男性3,000円 / 女性2,500円）なら自動分割せず人に任せる。
    if (/男性|女性/.test(legacy) && /[0-9],[0-9]{3}/.test(legacy)) {
      ambiguous.push({ id: row.id, price: legacy });
      continue;
    }
    await prisma.$executeRaw`
      UPDATE "event_price_plans"
      SET "amount" = ${parsed.amount},
          "note" = ${parsed.note}
      WHERE "id" = ${row.id}::uuid
    `;
    updated += 1;
  }
  return { updated, ambiguous };
}

async function main() {
  const schedules = await backfillSchedules();
  console.log(`開催時間: ${schedules.updated} 件を更新`);
  if (schedules.unresolved.length > 0) {
    console.log("開催時間を解析できなかった行（開始・終了を手で入れてください）:");
    for (const row of schedules.unresolved) console.log(`  - ${row.id}: ${row.eventTime}`);
  }

  const prices = await backfillPrices();
  console.log(`費用: ${prices.updated} 件を更新`);
  if (prices.ambiguous.length > 0) {
    console.log("男女複合のため自動分割しなかった行（プランを分けて入れ直してください）:");
    for (const row of prices.ambiguous) console.log(`  - ${row.id}: ${row.price}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
