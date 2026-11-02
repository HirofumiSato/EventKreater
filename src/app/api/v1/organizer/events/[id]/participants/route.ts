import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import {
  composeScheduleLabels,
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
import { participantScheduleIds } from "@/modules/participants/lib/rsvp";
import {
  discountTotal,
  payableAmount,
  summarizeRevenue,
  unitPayableAmount,
} from "@/modules/revenue/lib/revenue";

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
            discounts: { orderBy: { sortOrder: "asc" } },
            schedules: {
              select: {
                scheduleId: true,
                schedule: { select: { eventDate: true, eventTime: true, sortOrder: true } },
              },
            },
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
      stats: summarizeStatuses(participants),
      // 名簿を開いたついでに売上サマリも出す。内訳は /revenue で見る。
      revenue: summarizeRevenue(participants),
      participants: participants.map((row) => {
        const price = participantPriceDisplay(row);
        const scheduleIds = participantScheduleIds(row.schedules, row.scheduleId);
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          gender: row.gender,
          comment: row.comment,
          scheduleId: row.scheduleId,
          scheduleIds,
          partySize: row.partySize,
          pricePlanId: row.pricePlanId,
          // 選んだ全日程を出す。古い回答は代表の 1 件に戻す。
          scheduleLabel:
            row.schedules.length > 0
              ? composeScheduleLabels(row.schedules.map((link) => link.schedule))
              : row.schedule
                ? `${formatEventDateLabel(formatEventDate(row.schedule.eventDate))} ${row.schedule.eventTime}`
                : null,
          pricePlanLabel: price.label,
          pricePlanAmount: price.amount,
          discounts: serializeParticipantDiscounts(row.discounts),
          discountAmount: discountTotal(row.discounts) * row.partySize,
          payableAmount: payableAmount({
            priceAmount: price.amount,
            discounts: row.discounts,
            partySize: row.partySize,
          }),
          // 集金は 1 人ずつ記録する。目安は人数を掛けない 1 人ぶんにする。
          unitPayableAmount: unitPayableAmount({
            priceAmount: price.amount,
            discounts: row.discounts,
          }),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          waitlistedAt: row.waitlistedAt ? row.waitlistedAt.toISOString() : null,
          waitlistPosition: waitlistPosition(waitlistRows, row.id),
          collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
        };
      }),
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants`);
  }
}
