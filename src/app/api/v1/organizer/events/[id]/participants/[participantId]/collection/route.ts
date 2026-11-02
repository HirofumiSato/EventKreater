import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { ParticipantCollectionSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string; participantId: string };
}

/**
 * 参加費の集金を記録する。
 * 名簿の 1 枚から 1 タップで切り替えるので、出欠・割引・人数には触らない。
 * 金額は見込み額（`payableAmount`）をそのまま使い、別入力にはしない。
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const input = ParticipantCollectionSchema.parse(await req.json().catch(() => null));
    const participant = await prisma.participant.findFirst({
      where: { id: params.participantId, eventId: params.id, event: { isDeleted: false } },
      select: { id: true, status: true },
    });
    if (!participant) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "参加者が見つかりません。",
      });
    }
    if (participant.status !== "ATTENDING") {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail:
          participant.status === "WAITLISTED"
            ? "参加要望中の参加者には集金を記録できません。先に参加を承認してください。"
            : "欠席の参加者には集金を記録できません。",
      });
    }

    const updated = await prisma.participant.update({
      where: { id: participant.id },
      data: { collectedAt: input.collected ? new Date() : null },
      select: { id: true, collectedAt: true },
    });

    return NextResponse.json({
      participant: {
        id: updated.id,
        collectedAt: updated.collectedAt ? updated.collectedAt.toISOString() : null,
      },
    });
  } catch (error) {
    return toErrorResponse(
      error,
      `/api/v1/organizer/events/${params.id}/participants/${params.participantId}/collection`,
    );
  }
}
