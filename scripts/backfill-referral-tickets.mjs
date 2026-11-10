/**
 * 紹介のチケットが付かなかった公開を、あとから配り直す。
 *
 * 編集画面の「公開状態」を「公開中」にして保存すると、公開は成立するのに紹介者への
 * 付与（`grantReferralTickets`）が呼ばれていなかった期間がある。このスクリプトは、
 * 紹介されて登録し、すでに公開しているのに `reason_key = referral:<userId>:0` が
 * 無い会員を拾って、本来配るはずだった枚数を埋める。
 *
 * 条件と枚数は `src/modules/billing/lib/referral.ts` と `tickets.ts` に合わせる。
 * 自己紹介・退会した紹介者・生涯10枚の上限はここでも同じように弾く。期限は
 * 「配った時点から3か月」にする（公開日に遡らせると、届いた時には切れている券になる）。
 *
 * 何度実行しても安全（`reason_key` の UNIQUE と `skipDuplicates` で冪等）。
 * 既定は下見だけで、`--apply` を付けたときだけ書き込む。
 * 通知（REFERRAL_GRANTED）は作らない。配ったことは紹介者のマイページで分かる。
 *
 * 使い方:
 *   npm run db:backfill:referral            # 対象と枚数を出すだけ
 *   npm run db:backfill:referral -- --apply # 実際に配る
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** tickets.ts と同じ値。スクリプトは TS を読めないため複製する。 */
const REFERRAL_TICKET_GRANT = 2;
const REFERRAL_TICKET_LIMIT = 10;
const REFERRAL_TICKET_MONTHS = 3;

/** pricing.ts の addMonthsUtc と同じ（月末を丸める）。 */
function addMonthsUtc(date, months) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** tickets.ts の referralGrantSize と同じ。9枚なら1枚、10枚なら0枚。 */
function referralGrantSize(grantedCount) {
  const remaining = REFERRAL_TICKET_LIMIT - Math.max(0, grantedCount);
  if (remaining <= 0) return 0;
  return remaining === 1 ? 1 : REFERRAL_TICKET_GRANT;
}

/**
 * 配り直す相手。紹介されて登録し、公開したことがあり（`quota_charged_at` が入っている）、
 * 紹介者の側にこの人の券が1枚も無い会員だけを返す。
 */
async function findMissing() {
  return prisma.$queryRaw`
    SELECT u."id" AS "userId",
           u."email" AS "guestEmail",
           u."referred_by_user_id" AS "referrerId",
           r."email" AS "referrerEmail"
    FROM "users" u
    JOIN "users" r ON r."id" = u."referred_by_user_id"
    WHERE u."deleted_at" IS NULL
      AND r."deleted_at" IS NULL
      AND u."referred_by_user_id" <> u."id"
      AND EXISTS (
        SELECT 1
        FROM "event_organizers" eo
        JOIN "events" e ON e."id" = eo."event_id"
        WHERE eo."user_id" = u."id"
          AND eo."role" = 'OWNER'
          AND e."quota_charged_at" IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "free_tickets" f
        WHERE f."user_id" = r."id"
          AND f."source" = 'REFERRAL'
          AND f."reason_key" LIKE 'referral:' || u."id"::text || ':%'
      )
    ORDER BY u."created_at"
  `;
}

/** 紹介者の生涯枚数を数えて、配る枚数を決める。数え上げは行を押さえてから（本体と同じ）。 */
async function grant(row, db) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${row.referrerId}::uuid FOR UPDATE`;
    const grantedCount = await tx.freeTicket.count({
      where: { userId: row.referrerId, source: "REFERRAL" },
    });
    const size = referralGrantSize(grantedCount);
    if (size === 0) return 0;

    const issuedAt = new Date();
    const created = await tx.freeTicket.createMany({
      data: Array.from({ length: size }, (_, index) => ({
        userId: row.referrerId,
        source: "REFERRAL",
        grantedByUserId: row.userId,
        reasonKey: `referral:${row.userId}:${index}`,
        issuedAt,
        expiresAt: addMonthsUtc(issuedAt, REFERRAL_TICKET_MONTHS),
      })),
      skipDuplicates: true,
    });
    return created.count;
  });
}

/** 下見。書き込まずに、いま配ると何枚になるかだけを数える。 */
async function preview(row) {
  const grantedCount = await prisma.freeTicket.count({
    where: { userId: row.referrerId, source: "REFERRAL" },
  });
  return referralGrantSize(grantedCount);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await findMissing();

  if (rows.length === 0) {
    console.log("配り直す相手はいませんでした。");
    return;
  }

  console.log(
    apply
      ? `対象 ${rows.length} 件に配ります。`
      : `対象 ${rows.length} 件（下見。--apply で実際に配ります）。`,
  );

  let total = 0;
  const capped = [];
  for (const row of rows) {
    const size = apply ? await grant(row, prisma) : await preview(row);
    if (size === 0) {
      capped.push(row);
      continue;
    }
    total += size;
    console.log(`  ${row.referrerEmail} ← ${row.guestEmail}: ${size}枚`);
  }

  if (capped.length > 0) {
    console.log(`生涯上限（${REFERRAL_TICKET_LIMIT}枚）に達していて配らなかった行:`);
    for (const row of capped) console.log(`  - ${row.referrerEmail} ← ${row.guestEmail}`);
  }
  console.log(`${apply ? "配った" : "配る"}: 合計 ${total} 枚`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
