import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { requireUserId } from "@/modules/auth/lib/guards";
import {
  participationInclude,
  participationWhere,
  serializeParticipation,
  todayInTokyo,
} from "@/modules/participants/lib/participations";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  status: z.enum(["ATTENDING", "DECLINED", "WAITLISTED"]).optional(),
  scope: z.enum(["all", "upcoming", "past"]).default("all"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * 参加者の参加履歴。主催者向けの /api/v1/organizer/events とは別の入口にして、
 * 画面ごとに役割のデータが混ざらないようにする。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const params = req.nextUrl.searchParams;
    const query = QuerySchema.parse({
      status: params.get("status") ?? undefined,
      scope: params.get("scope") ?? undefined,
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    const today = todayInTokyo();
    const where = participationWhere(userId, query, today);
    const skip = (query.page - 1) * query.limit;

    const [rows, total, attending, declined, waitlisted, upcoming, past] = await Promise.all([
      prisma.participant.findMany({
        where,
        include: participationInclude,
        orderBy:
          query.scope === "upcoming"
            ? [{ event: { sortDate: "asc" } }, { updatedAt: "desc" }]
            : [{ updatedAt: "desc" }],
        skip,
        take: query.limit,
      }),
      prisma.participant.count({ where }),
      // 要約の 3 つも名簿から外した行を数えない（履歴の `where` と同じ条件）。
      prisma.participant.count({
        where: { userId, event: { isDeleted: false }, status: "ATTENDING", ...ACTIVE_PARTICIPANT_WHERE },
      }),
      prisma.participant.count({
        where: { userId, event: { isDeleted: false }, status: "DECLINED", ...ACTIVE_PARTICIPANT_WHERE },
      }),
      // 参加要望は参加人数にも欠席にも数えない。待ち順で承認されるまで別枠で持つ。
      prisma.participant.count({
        where: { userId, event: { isDeleted: false }, status: "WAITLISTED", ...ACTIVE_PARTICIPANT_WHERE },
      }),
      prisma.participant.count({
        where: participationWhere(userId, { scope: "upcoming" }, today),
      }),
      prisma.participant.count({
        where: participationWhere(userId, { scope: "past" }, today),
      }),
    ]);

    return NextResponse.json({
      items: rows.map(serializeParticipation),
      page: query.page,
      limit: query.limit,
      total,
      hasMore: skip + rows.length < total,
      summary: { attending, declined, waitlisted, upcoming, past },
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/participations");
  }
}
