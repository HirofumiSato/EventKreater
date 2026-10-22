import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { serializeOrganizerList } from "@/lib/serializers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * このイベントの幹事一覧。筆頭幹事（オーナー）と共同主催者を分けて返す。
 * 閲覧は幹事なら誰でもできる。招待・削除はオーナーだけ（canManage）。
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertOrganizer(req, params.id);
    const organizers = await prisma.eventOrganizer.findMany({
      where: { eventId: params.id },
      select: {
        id: true,
        role: true,
        userId: true,
        displayName: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      organizers: serializeOrganizerList(organizers),
      role: ctx.role,
      canManage: ctx.role === "OWNER" && Boolean(ctx.userId),
      /** 未登録の幹事は、共同主催の管理に必要な会員登録へ送る。 */
      registerRequired: ctx.role === "OWNER" && !ctx.userId,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/organizers`);
  }
}
