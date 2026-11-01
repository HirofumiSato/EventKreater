import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { requireUserId } from "@/modules/auth/lib/guards";
import { migrateGuestOrganizers } from "@/modules/auth/lib/hydrate";
import { toErrorResponse } from "@/lib/http";
import { HydrateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

/**
 * 端末だけの参加行を畳む前に、選んだ日程を残す方へ写す。
 * join 行は参加行の削除で一緒に消えるので、先に移しておく。
 */
async function mergeParticipantSchedules(
  tx: Prisma.TransactionClient,
  fromParticipantId: string,
  toParticipantId: string,
): Promise<void> {
  const rows = await tx.participantSchedule.findMany({
    where: { participantId: fromParticipantId },
    select: { scheduleId: true },
  });
  if (rows.length === 0) return;
  await tx.participantSchedule.createMany({
    data: rows.map((row) => ({ participantId: toParticipantId, scheduleId: row.scheduleId })),
    skipDuplicates: true,
  });
}

export async function POST(req: NextRequest) {  try {
    const userId = await requireUserId(req);
    HydrateSchema.parse(await req.json().catch(() => ({})));

    const rsvpTokens = unique(
      req.cookies
        .getAll()
        .filter((cookie) => cookie.name.startsWith("rsvp_token_"))
        .map((cookie) => cookie.value),
    );
    const guestTokens = unique(
      req.cookies
        .getAll()
        .filter((cookie) => cookie.name.startsWith("org_token_"))
        .map((cookie) => cookie.value),
    );

    const result = await prisma.$transaction(async (tx) => {
      let migratedParticipants = 0;
      let migratedOrganizers = 0;
      let promotedOwners = 0;
      let freeEventCount: number | null = null;

      if (rsvpTokens.length > 0) {
        const hashes = rsvpTokens.map((token) => sha256(token));
        const anonymousRows = await tx.participant.findMany({
          where: { rsvpTokenHash: { in: hashes }, userId: null },
          include: { receipt: { select: { id: true } } },
        });
        for (const row of anonymousRows) {
          const already = await tx.participant.findFirst({
            where: { eventId: row.eventId, userId },
            include: { receipt: { select: { id: true } } },
          });
          if (!already) {
            await tx.participant.update({ where: { id: row.id }, data: { userId } });
            migratedParticipants += 1;
            continue;
          }
          // 同じイベントに会員の行と端末だけの行がある。領収書を持つ方を残す。
          if (row.receipt && !already.receipt) {
            await mergeParticipantSchedules(tx, already.id, row.id);
            await tx.participant.update({ where: { id: row.id }, data: { userId } });
            await tx.participant.delete({ where: { id: already.id } });
            migratedParticipants += 1;
            continue;
          }
          // 会員の行を残し、端末の行が新しければ内容だけ引き継ぐ。
          if (row.updatedAt > already.updatedAt) {
            await tx.participant.update({
              where: { id: already.id },
              data: {
                name: row.name,
                status: row.status,
                comment: row.comment,
                scheduleId: row.scheduleId,
                partySize: row.partySize,
                pricePlanId: row.pricePlanId,
                ipHash: row.ipHash,
              },
            });
          }
          // 端末の行が持つ日程は、残す行へ写してから畳む。
          await mergeParticipantSchedules(tx, row.id, already.id);
          await tx.participant.delete({ where: { id: row.id } });
          migratedParticipants += 1;
        }
      }

      if (guestTokens.length > 0) {
        const guest = await migrateGuestOrganizers(tx, userId, guestTokens);
        migratedOrganizers = guest.migratedOrganizers;
        promotedOwners = guest.promotedOwners;
        freeEventCount = guest.freeEventCount;
      }

      return { success: true, migratedParticipants, migratedOrganizers, promotedOwners, freeEventCount };
    });

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/hydrate");
  }
}
