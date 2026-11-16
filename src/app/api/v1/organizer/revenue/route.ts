import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireOrganizerAccount } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { formatEventDate, parseEventDate } from "@/lib/serializers";
import { summarizeRevenue } from "@/modules/revenue/lib/revenue";
import { allocateRevenue } from "@/modules/revenue/lib/allocation";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;
type EventStatusFilter = (typeof STATUSES)[number];

/** 期間の指定が無いときに遡る長さ。過去の催しを全部読み直さないための既定。 */
const DEFAULT_PAST_DAYS = 365;

/** 1 回に集計する催しの上限。期間で絞ったうえでも、際限なく読まない。 */
const MAX_EVENTS = 300;

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
 * 期間は開催日（`Event.sortDate`）で絞る。指定が無ければ直近 1 年を集計し、
 * 実際に集計した期間を `period` で返す（全期間と表示して 1 年分だけ数えない）。
 * 金額は出欠確定時点のスナップショットなので、料金プランを編集しても過去は動かない。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireOrganizerAccount(req);
    const url = new URL(req.url);
    const to = readDate(url.searchParams.get("to"), "to");
    // 期間の指定が無いときは直近 1 年。古い催しの参加者を毎回すべて読まないための既定。
    // `to` だけ指定されたときは、その日までの全期間（`from` は null のまま）にする。
    const from =
      readDate(url.searchParams.get("from"), "from") ??
      (to ? null : new Date(Date.now() - DEFAULT_PAST_DAYS * 86_400_000));
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
      // 上限で切るときに新しい催しが残るよう、開催日の新しい順に読む。
      // 応答の並びは読み込み後に開催日の古い順へ直す。
      orderBy: { event: { sortDate: "desc" } },
      take: MAX_EVENTS,
      select: {
        id: true,
        eventId: true,
        role: true,
        event: {
          select: {
            id: true,
            title: true,
            sortDate: true,
            status: true,
            organizers: { select: { id: true, role: true, userId: true } },
            revenueSetting: { select: { mode: true, visibility: true } },
            revenueShares: {
              select: { organizerId: true, shareBps: true, headcount: true },
            },
            participants: {
              // 売上は名簿に残っている行だけで数える。削除済みの集金は戻しても数えない。
              where: { ...ACTIVE_PARTICIPANT_WHERE },
              select: {
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
        },
      },
    });

    // 同じイベントに共同幹事として複数行あっても1件に畳む。
    const seen = new Map<string, { role: "OWNER" | "CO_HOST"; organizerId: string }>();
    const events = [];
    for (const organizer of organizers) {
      const event = organizer.event;
      const previous = seen.get(event.id);
      if (previous) {
        // 念のため、共同主催として先に出ても、筆頭幹事の行があればそちらを優先する。
        if (previous.role === "CO_HOST" && organizer.role === "OWNER") {
          seen.set(event.id, { role: "OWNER", organizerId: organizer.id });
        }
        continue;
      }
      seen.set(event.id, { role: organizer.role, organizerId: organizer.id });
      events.push(event);
    }
    // 開催日が近い順に並べる。過去のイベントは下へ送る。
    events.sort((a, b) => a.sortDate.getTime() - b.sortDate.getTime());

    const participants = events.flatMap((event) => event.participants);

    let totalMyShare = 0;
    const rows = events.map((event) => {
      const summary = summarizeRevenue(event.participants);
      const membership = seen.get(event.id);
      const allocation = allocateRevenue({
        mode: event.revenueSetting?.mode ?? "RATIO",
        organizers: event.organizers.map((row) => ({
          organizerId: row.id,
          role: row.role,
        })),
        shares: event.revenueShares,
        expectedRevenue: summary.expectedRevenue,
        collectedRevenue: summary.collectedRevenue,
        attendingCount: summary.attendingCount,
      });
      const myRow = allocation.rows.find(
        (row) => row.organizerId === membership?.organizerId,
      );
      const myShare = { expectedRevenue: myRow?.expectedRevenue ?? 0 };
      totalMyShare += myShare.expectedRevenue;
      return {
        id: event.id,
        title: event.title,
        sortDate: formatEventDate(event.sortDate),
        status: event.status,
        role: membership?.role ?? "CO_HOST",
        ...summary,
        myShare,
      };
    });

    return NextResponse.json({
      period: {
        from: from ? formatEventDate(from) : null,
        to: to ? formatEventDate(to) : null,
        status,
      },
      totals: summarizeRevenue(participants),
      myShare: { expectedRevenue: totalMyShare },
      events: rows,
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/organizer/revenue");
  }
}
