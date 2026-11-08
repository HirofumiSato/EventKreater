import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import {
  formatEventDate,
  isRsvpAccepting,
  serializeDiscounts,
  serializeFlyer,
  serializePricePlans,
  serializeSchedules,
} from "@/lib/serializers";
import { todayInTokyo } from "@/lib/calendar";
import { isFull, remainingSeats } from "@/modules/events/lib/rsvp-status";
import { sortOrganizerEvents } from "@/modules/organizers/lib/public-page";
import type { PublicOrganizerEvent } from "@/modules/events/types";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { userId: string };
}

/**
 * 主催者のイベント（`/organizers/[userId]/events` の元データ）。
 *
 * 誰でも読める（SNS の固定リンクから開けるようにするため）。掲載条件を満たす
 * 催しだけを返し、1件も無くても空の一覧を 200 で返す。
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const organizer = await prisma.user.findFirst({
      where: { id: params.userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!organizer) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "主催者が見つかりません。",
      });
    }

    // 筆頭幹事と共同主催の両方のイベントを集める。
    const rows = await prisma.eventOrganizer.findMany({
      where: { userId: organizer.id },
      select: {
        event: {
          select: {
            id: true,
            title: true,
            sortDate: true,
            location: true,
            capacity: true,
            status: true,
            isDeleted: true,
            rsvpDeadline: true,
            flyerAsset: true,
            schedules: { orderBy: { sortOrder: "asc" } },
            pricePlans: { orderBy: { sortOrder: "asc" } },
            discounts: { orderBy: { sortOrder: "asc" } },
            participants: {
              // 公開ページの人数・残席は名簿に残っている行だけで数える。
              where: { status: { in: ["ATTENDING", "WAITLISTED"] }, ...ACTIVE_PARTICIPANT_WHERE },
              select: { status: true, partySize: true },
            },
          },
        },
      },
    });

    const today = todayInTokyo();
    const candidates = rows.map((row) => {
      const event = row.event;
      const attendingCount = event.participants
        .filter((participant) => participant.status === "ATTENDING")
        .reduce((total, participant) => total + participant.partySize, 0);
      const rsvpOpen = isRsvpAccepting(event);
      const full = isFull(event.capacity, attendingCount);
      return {
        id: event.id,
        title: event.title,
        status: event.status,
        isDeleted: event.isDeleted,
        rsvpOpen,
        sortDate: formatEventDate(event.sortDate),
        schedules: serializeSchedules(event.schedules),
        pricePlans: serializePricePlans(event.pricePlans),
        discounts: serializeDiscounts(event.discounts),
        location: event.location,
        capacity: event.capacity,
        attendingCount,
        remainingSeats: remainingSeats(event.capacity, attendingCount),
        isFull: full,
        acceptsWaitlist: full && rsvpOpen,
        flyerAsset: serializeFlyer(event.flyerAsset),
        flyerThumbnailUrl: event.flyerAsset?.imageUrl ?? null,
      };
    });

    const events: PublicOrganizerEvent[] = sortOrganizerEvents(candidates, today);

    return NextResponse.json({
      organizer: { userId: organizer.id, name: organizer.name },
      events,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/organizers/${params.userId}/events`);
  }
}
