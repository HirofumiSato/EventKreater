import type { Prisma } from "@prisma/client";
import { sha256 } from "@/lib/crypto";
import { FREE_EVENT_LIMIT } from "@/modules/billing/lib/quota";

/**
 * 端末で作ったイベントを会員の無料枠に移したあとの件数。
 * 登録によって枠が増えないよう、上限で頭打ちにする。
 */
export function mergedFreeEventCount(current: number, migratedOwners: number): number {
  const base = Number.isFinite(current) ? Math.max(0, Math.trunc(current)) : 0;
  const added = Number.isFinite(migratedOwners) ? Math.max(0, Math.trunc(migratedOwners)) : 0;
  return Math.min(FREE_EVENT_LIMIT, base + added);
}

export interface GuestMigrationResult {
  /** 会員に付け替えた幹事行の数（OWNER と CO_HOST の合計）。 */
  migratedOrganizers: number;
  /** そのうち筆頭幹事（OWNER）だった数。無料枠として数える対象。 */
  promotedOwners: number;
  /** 付け替え後に確定した無料枠の消費数。移行が無ければ null。 */
  freeEventCount: number | null;
}

/**
 * 端末のゲスト幹事トークンで作られた幹事行を、いまログインした会員に付け替える。
 * 筆頭幹事だった分だけを `freeEventCount` に足し、端末で作ったイベントも
 * 会員の無料枠を使ったものとして扱う。共同幹事（CO_HOST）は他人のイベントなので数えない。
 */
export async function migrateGuestOrganizers(
  tx: Prisma.TransactionClient,
  userId: string,
  guestTokens: string[],
): Promise<GuestMigrationResult> {
  const result: GuestMigrationResult = {
    migratedOrganizers: 0,
    promotedOwners: 0,
    freeEventCount: null,
  };
  if (guestTokens.length === 0) return result;

  const hashes = guestTokens.map((token) => sha256(token));
  const organizers = await tx.eventOrganizer.findMany({
    where: { guestTokenHash: { in: hashes }, userId: null },
  });

  for (const organizer of organizers) {
    const already = await tx.eventOrganizer.findFirst({
      where: { eventId: organizer.eventId, userId },
    });
    if (already) {
      await tx.eventOrganizer.delete({ where: { id: organizer.id } });
      continue;
    }
    await tx.eventOrganizer.update({
      where: { id: organizer.id },
      data: { userId, guestTokenHash: null },
    });
    result.migratedOrganizers += 1;
    if (organizer.role === "OWNER") result.promotedOwners += 1;
  }

  if (result.promotedOwners > 0) {
    const quota = await tx.userUsageQuota.findUnique({
      where: { userId },
      select: { freeEventCount: true },
    });
    const freeEventCount = mergedFreeEventCount(quota?.freeEventCount ?? 0, result.promotedOwners);
    await tx.userUsageQuota.upsert({
      where: { userId },
      create: { userId, freeEventCount },
      update: { freeEventCount },
    });
    result.freeEventCount = freeEventCount;
  }

  return result;
}
