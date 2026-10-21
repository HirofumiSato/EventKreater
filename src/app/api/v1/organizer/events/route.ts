import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { collectGuestTokenHashes, resolveUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { serializeOrganizerListItem, summarizeStatuses } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    const guestHashes = collectGuestTokenHashes(req);
    if (!userId && guestHashes.length === 0) {
      throw new ProblemDetailException({
        status: 401,
        title: "Unauthorized",
        detail: "主催イベントを表示するにはログインするか、幹事トークンが必要です。",
      });
    }

    const organizers = await prisma.eventOrganizer.findMany({
      where: {
        event: { isDeleted: false },
        OR: [
          ...(userId ? [{ userId }] : []),
          ...(guestHashes.length > 0 ? [{ guestTokenHash: { in: guestHashes } }] : []),
        ],
      },
      include: {
        event: {
          include: { flyerAsset: true, ...eventOptionsInclude, participants: { select: { status: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const seen = new Set<string>();
    const events = [];
    for (const organizer of organizers) {
      if (seen.has(organizer.eventId)) continue;
      seen.add(organizer.eventId);
      events.push(
        serializeOrganizerListItem(
          organizer.event,
          organizer.role,
          summarizeStatuses(organizer.event.participants.map((row) => row.status)),
        ),
      );
    }

    return NextResponse.json({ events });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/organizer/events");
  }
}
