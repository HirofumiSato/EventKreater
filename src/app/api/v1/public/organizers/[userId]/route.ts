import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import {
  formatEventDate,
  isRsvpAccepting,
  serializeFlyer,
  serializePricePlans,
  serializeSchedules,
} from "@/lib/serializers";
import { todayInTokyo } from "@/lib/calendar";
import { resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { isFull, remainingSeats } from "@/modules/events/lib/rsvp-status";
import { sortOrganizerEvents } from "@/modules/organizers/lib/public-page";
import type { PublicOrganizerEvent } from "@/modules/events/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { userId: string };
}

/**
 * 主催者の公開ページ（`/organizers/[userId]`）。
 *
 * 中身はログイン済みの参加者にだけ返す。未ログインでもURLは開けるが、
 * 画面はぼかした骨組みを出し、このAPIは催しを1件も返さない。
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const viewerId = await resolveOptionalUserId(req);
    if (!viewerId) {
      throw new ProblemDetailException({
        status: 403,
        title: "Login Required",
        type: "probs/login-required",
        detail: "このページは参加者登録・ログイン後に閲覧できます。",
        error: "LOGIN_REQUIRED",
      });
    }

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

    // 筆頭幹事と共同主催の両方の催しを集める。
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
            participants: {
              where: { status: { in: ["ATTENDING", "WAITLISTED"] } },
              select: { status: true },
            },
          },
        },
      },
    });

    const today = todayInTokyo();
    const candidates = rows.map((row) => {
      const event = row.event;
      const attendingCount = event.participants.filter((participant) => participant.status === "ATTENDING").length;
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
    return toErrorResponse(error, `/api/v1/public/organizers/${params.userId}`);
  }
}
