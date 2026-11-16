import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { requireUserId } from "@/modules/auth/lib/guards";
import {
  calendarEntrySelect,
  calendarMonthFilter,
  serializeCalendarEntries,
} from "@/modules/participants/lib/participations";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 参加者カレンダー。出席・欠席の両方を、出欠で選んだ日程の日付に置く。
 * 既定は月をまたいで全件を返し、クライアントで表示月だけを切り出す。
 *
 * `?month=YYYY-MM` を付けたときだけ、その月の回答に絞る（追加の任意パラメータ）。
 * 画面はまだ付けていないが、付けたときに表示月の往復だけを読めるようにしておく。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const month = new URL(req.url).searchParams.get("month");
    const monthFilter = month ? calendarMonthFilter(month) : null;
    if (month && !monthFilter) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "month は YYYY-MM の形式で指定してください。",
      });
    }

    // カレンダーに出さない列（金額・割引・概要・住所）は引かない。
    // 並びは画面が日付ごとに組み直すので、DB 側の orderBy は持たない。
    const rows = await prisma.participant.findMany({
      where: {
        userId,
        event: { isDeleted: false },
        ...ACTIVE_PARTICIPANT_WHERE,
        ...monthFilter,
      },
      select: calendarEntrySelect,
    });
    return NextResponse.json({ items: rows.flatMap(serializeCalendarEntries) });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/calendar");
  }
}
