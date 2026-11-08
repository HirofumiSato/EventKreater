import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { formatEventDate, formatEventDateLabel } from "@/lib/serializers";
import { groupByPlan, groupBySchedule, summarizeRevenue } from "@/modules/revenue/lib/revenue";
import { buildAllocationView } from "@/modules/revenue/lib/allocation-view";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * イベント1件の売上内訳。
 * 金額は出欠確定時点のスナップショットを使うので、料金プランを編集しても過去は動かない。
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertRegisteredOrganizer(req, params.id);
    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      select: {
        id: true,
        title: true,
        sortDate: true,
        status: true,
        organizers: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            userId: true,
            displayName: true,
            user: { select: { name: true } },
          },
        },
        revenueSetting: { select: { mode: true, visibility: true } },
        revenueShares: { select: { organizerId: true, shareBps: true, headcount: true } },
        schedules: { orderBy: { sortOrder: "asc" } },
        participants: {
          // 削除済みは売上・内訳・按分のどれにも数えない。
          where: { ...ACTIVE_PARTICIPANT_WHERE },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            status: true,
            priceAmount: true,
            pricePlanName: true,
            priceAudience: true,
            scheduleId: true,
            partySize: true,
            discounts: { select: { amount: true } },
            collectedAt: true,
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

    const bySchedule = groupBySchedule(event.participants).map((row) => {
      const schedule = event.schedules.find((item) => item.id === row.scheduleId);
      return {
        scheduleId: row.scheduleId,
        label: schedule
          ? `${formatEventDateLabel(formatEventDate(schedule.eventDate))} ${schedule.eventTime}`
          : "日時なし",
        attendingCount: row.attendingCount,
        discountSubtotal: row.discountSubtotal,
        subtotal: row.subtotal,
      };
    });
    // 開催日の順に並べ、日時が消えた行は最後へ送る。
    bySchedule.sort((a, b) => {
      if (a.scheduleId === null) return 1;
      if (b.scheduleId === null) return -1;
      return a.label.localeCompare(b.label);
    });

    const summary = summarizeRevenue(event.participants);
    const allocation = buildAllocationView({
      organizers: event.organizers,
      setting: event.revenueSetting,
      shares: event.revenueShares,
      viewerUserId: ctx.userId,
      viewerRole: ctx.role ?? "CO_HOST",
      expectedRevenue: summary.expectedRevenue,
      collectedRevenue: summary.collectedRevenue,
      attendingCount: summary.attendingCount,
    });

    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        sortDate: formatEventDate(event.sortDate),
        status: event.status,
      },
      summary,
      byPlan: groupByPlan(event.participants),
      bySchedule,
      allocation,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/revenue`);
  }
}
