import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string; organizerId: string };
}

/**
 * 共同主催者を外す。行の削除であって、イベントや名簿には触れない。
 * 筆頭幹事は外せない（イベントにオーナーが居なくなるため）。
 * 外れる人が編集ロックを持っていたら、同じトランザクションで解放する。
 * 権限だけ外すと、ロックを解放する手段が誰にも無くなるため。
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOwner(req, params.id);

    const target = await prisma.eventOrganizer.findFirst({
      where: { id: params.organizerId, eventId: params.id },
      select: { id: true, role: true, userId: true, guestTokenHash: true },
    });
    if (!target) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "その共同主催者は見つかりません。",
      });
    }
    if (target.role === "OWNER") {
      throw new ProblemDetailException({
        status: 409,
        title: "Conflict",
        detail: "筆頭幹事は外せません。イベントを削除するか、共同主催者を外してください。",
        error: "OWNER_NOT_REMOVABLE",
      });
    }

    const lockHolders = [
      ...(target.userId ? [{ lockedByUserId: target.userId }] : []),
      ...(target.guestTokenHash ? [{ lockedByTokenHash: target.guestTokenHash }] : []),
    ];

    await prisma.$transaction(async (tx) => {
      if (lockHolders.length > 0) {
        await tx.eventLock.deleteMany({
          where: { eventId: params.id, OR: lockHolders },
        });
      }
      await tx.eventOrganizer.delete({ where: { id: target.id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(
      error,
      `/api/v1/organizer/events/${params.id}/organizers/${params.organizerId}`,
    );
  }
}
