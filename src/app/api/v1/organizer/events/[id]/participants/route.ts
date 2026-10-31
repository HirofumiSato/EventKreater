import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import {
  formatEventDate,
  formatEventDateLabel,
  participantPriceDisplay,
  serializeParticipantDiscounts,
  serializePricePlans,
  serializeSchedules,
  summarizeStatuses,
} from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";
import { waitlistPosition } from "@/modules/events/lib/rsvp-status";
import { discountTotal, payableAmount, summarizeRevenue } from "@/modules/revenue/lib/revenue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      include: {
        ...eventOptionsInclude,
        participants: {
          include: {
            schedule: true,
            pricePlan: true,
            receipt: true,
            discounts: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    const participants = [...event.participants].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const waitlistRows = participants.filter((row) => row.status === "WAITLISTED");
    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        capacity: event.capacity,
        schedules: serializeSchedules(event.schedules),
        pricePlans: serializePricePlans(event.pricePlans),
      },
      stats: summarizeStatuses(participants.map((row) => row.status)),
      // 名簿を開いたついでに売上サマリも出す。内訳は /revenue で見る。
      revenue: summarizeRevenue(
        participants,
        participants.flatMap((row) => (row.receipt ? [row.receipt] : [])),
      ),
      participants: participants.map((row) => {
        const price = participantPriceDisplay(row);
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          gender: row.gender,
          comment: row.comment,
          scheduleId: row.scheduleId,
          pricePlanId: row.pricePlanId,
          scheduleLabel: row.schedule
            ? `${formatEventDateLabel(formatEventDate(row.schedule.eventDate))} ${row.schedule.eventTime}`
            : null,
          pricePlanLabel: price.label,
          pricePlanAmount: price.amount,
          discounts: serializeParticipantDiscounts(row.discounts),
          discountAmount: discountTotal(row.discounts),
          payableAmount: payableAmount({ priceAmount: price.amount, discounts: row.discounts }),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          waitlistedAt: row.waitlistedAt ? row.waitlistedAt.toISOString() : null,
          waitlistPosition: waitlistPosition(waitlistRows, row.id),
          receipt: row.receipt ? { id: row.receipt.id, issuedAt: row.receipt.issuedAt.toISOString() } : null,
        };
      }),
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants`);
  }
}
