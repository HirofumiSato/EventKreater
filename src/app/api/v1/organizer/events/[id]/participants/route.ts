import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import {
  formatEventDate,
  pricePlanChoiceLabel,
  serializePricePlans,
  serializeSchedules,
  summarizeStatuses,
} from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";

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
        participants: { include: { schedule: true, pricePlan: true, receipt: true } },
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
    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        capacity: event.capacity,
        schedules: serializeSchedules(event.schedules),
        pricePlans: serializePricePlans(event.pricePlans),
      },
      stats: summarizeStatuses(participants.map((row) => row.status)),
      participants: participants.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        gender: row.gender,
        comment: row.comment,
        scheduleId: row.scheduleId,
        pricePlanId: row.pricePlanId,
        scheduleLabel: row.schedule ? `${formatEventDate(row.schedule.eventDate)} ${row.schedule.eventTime}` : null,
        pricePlanLabel: row.pricePlan ? pricePlanChoiceLabel(row.pricePlan) : null,
        pricePlanAmount: row.pricePlan?.amount ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        receipt: row.receipt ? { id: row.receipt.id, issuedAt: row.receipt.issuedAt.toISOString() } : null,
      })),
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants`);
  }
}
