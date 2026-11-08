import type { Participant, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

type Db = Prisma.TransactionClient | typeof prisma;

export interface FoundParticipant {
  participant: Participant;
  /** 端末のクッキーで見つけたのか、ログイン中の会員として見つけたのか。 */
  matchedBy: "token" | "user";
}

/**
 * 出欠ページを開いている人の参加行を探す。
 * まず端末のクッキー、無ければログイン中の会員。未ログインなら null。
 */
export async function findMyParticipant(
  db: Db,
  input: { eventId: string; tokenHash: string | null; userId: string | null },
): Promise<FoundParticipant | null> {
  if (input.tokenHash) {
    const byToken = await db.participant.findFirst({
      // 名簿から外した行は「自分の回答」ではない。端末のクッキーが残っていても拾わない。
      where: { eventId: input.eventId, rsvpTokenHash: input.tokenHash, ...ACTIVE_PARTICIPANT_WHERE },
    });
    if (byToken) return { participant: byToken, matchedBy: "token" };
  }
  if (input.userId) {
    const byUser = await db.participant.findFirst({
      where: { eventId: input.eventId, userId: input.userId, ...ACTIVE_PARTICIPANT_WHERE },
    });
    if (byUser) return { participant: byUser, matchedBy: "user" };
  }
  return null;
}

/**
 * 選んだ日程の ID を、イベントの並び順（`sortOrder`）で返す。
 * 複数日を選べるので、`Participant.scheduleId`（代表）の根拠もこの並びで決める。
 * 古い回答は join 行が空なので、そのときは `scheduleId` 1 件に戻す。
 */
export function participantScheduleIds(
  rows:
    | readonly { scheduleId: string; schedule?: { sortOrder: number } | null }[]
    | null
    | undefined,
  fallbackScheduleId: string | null = null,
): string[] {
  const sorted = [...(rows ?? [])]
    .sort((left, right) => (left.schedule?.sortOrder ?? 0) - (right.schedule?.sortOrder ?? 0))
    .map((row) => row.scheduleId);
  if (sorted.length > 0) return sorted;
  return fallbackScheduleId ? [fallbackScheduleId] : [];
}

export interface RsvpTarget {
  participant: Participant;
  /** 会員の行に統合した結果、削除する端末だけの行。 */
  stale: Participant | null;
}

/**
 * 書き込み対象の行をひとつに決める。
 * 同じ会員の行と、この端末の匿名行が別々にあるときは、会員の行を残して匿名行を畳む。
 */
export async function chooseRsvpTarget(
  tx: Prisma.TransactionClient,
  found: FoundParticipant,
  userId: string | null,
): Promise<RsvpTarget> {
  const current = found.participant;
  if (!userId) return { participant: current, stale: null };

  const owner =
    current.userId === userId
      ? current
      // 削除のときに `userId` を切るので当たらないが、同じ「この人の行」を探す条件として揃える。
      : await tx.participant.findFirst({
          where: { eventId: current.eventId, userId, ...ACTIVE_PARTICIPANT_WHERE },
        });

  if (!owner || owner.id === current.id) return { participant: current, stale: null };
  return { participant: owner, stale: current.userId ? null : current };
}
