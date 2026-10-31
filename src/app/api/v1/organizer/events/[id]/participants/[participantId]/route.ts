import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { OrganizerParticipantSchema } from "@/lib/schemas";
import {
  assertCapacityAllows,
  keepDiscountSnapshot,
  keepPriceSnapshot,
  lockEventForCapacity,
  resolveAttendanceChoice,
  resolveDiscountChoice,
} from "@/modules/events/lib/events";
import { waitlistPosition } from "@/modules/events/lib/rsvp-status";
import {
  formatEventDate,
  formatEventDateLabel,
  participantPriceDisplay,
  serializeParticipantDiscounts,
} from "@/lib/serializers";
import { discountTotal, payableAmount } from "@/modules/revenue/lib/revenue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string; participantId: string };
}

async function loadParticipant(eventId: string, participantId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    select: { id: true },
  });
  if (!event) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "イベントが見つかりません。",
    });
  }
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, eventId },
  });
  if (!participant) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "参加者が見つかりません。",
    });
  }
  return participant;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const input = OrganizerParticipantSchema.parse(await req.json());
    const current = await loadParticipant(params.id, params.participantId);
    const updated = await prisma.$transaction(async (tx) => {
      // 承認は席を1つ使う。数えてから書くまでを閉じ、他の承認と競合させない。
      await lockEventForCapacity(tx, params.id);
      await assertCapacityAllows(tx, params.id, input.status, current.id);
      const choice = await resolveAttendanceChoice(tx, params.id, input);
      const snapshot = keepPriceSnapshot(current, choice);
      /**
       * 割引の扱い。欠席・参加要望に変えたら消す。出席なら、幹事が選び直したときだけ入れ替える。
       * `discountIds` を省略した更新（名前だけの修正）では、参加者が選んだ割引を消さない。
       */
      let discountsData:
        | {
            deleteMany: Record<string, never>;
            create?: {
              discountId: string | null;
              name: string;
              amount: number;
              note: string | null;
              sortOrder: number;
            }[];
          }
        | undefined;
      if (input.status !== "ATTENDING") {
        discountsData = { deleteMany: {} };
      } else if (input.discountIds !== undefined) {
        const chosen = await resolveDiscountChoice(tx, params.id, input.status, input.discountIds);
        const currentDiscounts = await tx.participantDiscount.findMany({
          where: { participantId: current.id },
          select: { discountId: true, name: true, amount: true, note: true },
        });
        const kept = keepDiscountSnapshot(currentDiscounts, chosen);
        discountsData = {
          deleteMany: {},
          create: kept.map((row, sortOrder) => ({
            discountId: row.discountId,
            name: row.name,
            amount: row.amount,
            note: row.note,
            sortOrder,
          })),
        };
      }
      return tx.participant.update({
        where: { id: current.id },
        data: {
          name: input.name,
          status: input.status,
          gender: input.gender ?? current.gender,
          comment: input.comment ? input.comment : null,
          scheduleId: choice.scheduleId,
          pricePlanId: choice.pricePlanId,
          // 承認・辞退で要望ではなくなったら、待ち順の時刻を落とす。
          waitlistedAt:
            input.status === "WAITLISTED" ? (current.waitlistedAt ?? new Date()) : null,
          ...snapshot,
          ...(discountsData ? { discounts: discountsData } : {}),
        },
        include: { schedule: true, pricePlan: true, discounts: { orderBy: { sortOrder: "asc" } } },
      });
    });
    const waitlistRows = await prisma.participant.findMany({
      where: { eventId: params.id, status: "WAITLISTED" },
      select: { id: true, status: true, waitlistedAt: true, createdAt: true },
    });
    const price = participantPriceDisplay(updated);
    return NextResponse.json({
      participant: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        gender: updated.gender,
        comment: updated.comment,
        scheduleId: updated.scheduleId,
        pricePlanId: updated.pricePlanId,
        scheduleLabel: updated.schedule
          ? `${formatEventDateLabel(formatEventDate(updated.schedule.eventDate))} ${updated.schedule.eventTime}`
          : null,
        pricePlanLabel: price.label,
        pricePlanAmount: price.amount,
        discounts: serializeParticipantDiscounts(updated.discounts),
        discountAmount: discountTotal(updated.discounts),
        payableAmount: payableAmount({ priceAmount: price.amount, discounts: updated.discounts }),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        waitlistedAt: updated.waitlistedAt ? updated.waitlistedAt.toISOString() : null,
        waitlistPosition: waitlistPosition(waitlistRows, updated.id),
      },
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants/${params.participantId}`);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const current = await loadParticipant(params.id, params.participantId);
    await prisma.participant.delete({ where: { id: current.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants/${params.participantId}`);
  }
}
