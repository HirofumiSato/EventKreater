import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { requireUserId } from "@/modules/auth/lib/guards";
import {
  participationInclude,
  serializeCalendarEntry,
} from "@/modules/participants/lib/participations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 参加者カレンダー。出席・欠席の両方を、出欠で選んだ日程の日付に置く。
 * 参加履歴（/api/v1/user/participations）と違い、月をまたいで全件を返し、
 * クライアントで表示月だけを切り出す。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const rows = await prisma.participant.findMany({
      where: { userId, event: { isDeleted: false } },
      include: participationInclude,
      orderBy: [{ event: { sortDate: "asc" } }, { updatedAt: "desc" }],
    });
    return NextResponse.json({ items: rows.map(serializeCalendarEntry) });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/calendar");
  }
}
