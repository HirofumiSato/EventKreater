import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireOrganizerAccount } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { formatEventDate, parseEventDate } from "@/lib/serializers";
import { summarizeRevenue } from "@/modules/revenue/lib/revenue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;
type EventStatusFilter = (typeof STATUSES)[number];

function readDate(value: string | null, label: string): Date | null {
  if (!value) return null;
  if (!DATE_PATTERN.test(value)) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: `${label}は YYYY-MM-DD の形式で指定してください。`,
    });
  }
  return parseEventDate(value);
}

function readStatus(value: string | null): EventStatusFilter | null {
  if (!value) return null;
  const found = STATUSES.find((status) => status === value);
  if (!found) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "status は DRAFT / PUBLISHED / CLOSED のいずれかです。",
    });
  }
  return found;
}

/**
 * 主催イベントを横断した売上集計。
 * 期間は開催日（`Event.sortDate`）で絞る。初期表示は全期間。
 * 金額は出欠確定時点のスナップショットなので、費用プランを編集しても過去は動かない。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireOrganizerAccount(req);
    const url = new URL(req.url);
    const from = readDate(url.searchParams.get("from"), "from");
    const to = readDate(url.searchParams.get("to"), "to");
    const status = readStatus(url.searchParams.get("status"));

    const eventWhere: Prisma.EventWhereInput = { isDeleted: false };
    if (status) eventWhere.status = status;
    if (from || to) {
      eventWhere.sortDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const organizers = await prisma.eventOrganizer.findMany({
      where: { userId, event: eventWhere },
      select: {
        eventId: true,
        event: {
          select: {
            id: true,
            title: true,
            sortDate: true,
            status: true,
            participants: {
              select: {
                status: true,
                priceAmount: true,
                pricePlanName: true,
                priceAudience: true,
                scheduleId: true,
              },
            },
            receipts: { select: { amount: true } },
          },
        },
      },
    });

    // 同じイベントに共同幹事として複数行あっても1件に畳む。
    const seen = new Set<string>();
    const events = [];
    for (const organizer of organizers) {
      const event = organizer.event;
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
    // 開催日が近い順に並べる。過去のイベントは下へ送る。
    events.sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime());

    const participants = events.flatMap((event) => event.participants);
    const receipts = events.flatMap((event) => event.receipts);

    return NextResponse.json({
      period: {
        from: from ? formatEventDate(from) : null,
        to: to ? formatEventDate(to) : null,
        status,
      },
      totals: summarizeRevenue(participants, receipts),
      events: events.map((event) => ({
        id: event.id,
        title: event.title,
        sortDate: formatEventDate(event.sortDate),
        status: event.status,
        ...summarizeRevenue(event.participants, event.receipts),
      })),
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/organizer/revenue");
  }
}
