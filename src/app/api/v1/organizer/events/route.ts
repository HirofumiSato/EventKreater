import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { collectGuestTokenHashes, resolveUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { serializeOrganizerListItem, summarizeStatuses } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";
import { organizerLabel } from "@/modules/organizers/lib/names";

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
          include: {
            flyerAsset: true,
            ...eventOptionsInclude,
            participants: { select: { status: true } },
            organizers: {
              select: {
                id: true,
                role: true,
                userId: true,
                displayName: true,
                user: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const seen = new Set<string>();
    const events = [];
    for (const organizer of organizers) {
      if (seen.has(organizer.eventId)) continue;
      seen.add(organizer.eventId);
      const owner = organizer.event.organizers.find((row) => row.role === "OWNER");
      events.push(
        serializeOrganizerListItem(
          organizer.event,
          organizer.role,
          summarizeStatuses(organizer.event.participants.map((row) => row.status)),
          owner ? organizerLabel(owner) : "主催者",
        ),
      );
    }

    return NextResponse.json({ events });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/organizer/events");
  }
}
