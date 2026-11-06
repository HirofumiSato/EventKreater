import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { organizerLabel } from "@/modules/organizers/lib/names";
import { notifyCoHostRemoved } from "@/modules/notifications/lib/notify";

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
    const actor = await assertRegisteredOwner(req, params.id);

    const target = await prisma.eventOrganizer.findFirst({
      where: { id: params.organizerId, eventId: params.id },
      select: {
        id: true,
        role: true,
        userId: true,
        guestTokenHash: true,
        displayName: true,
        user: { select: { name: true } },
      },
    });
    if (!target) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "その共同主催・幹事は見つかりません。",
      });
    }
    if (target.role === "OWNER") {
      throw new ProblemDetailException({
        status: 409,
        title: "Conflict",
        detail: "主催者は外せません。イベントを削除するか、共同主催・幹事を外してください。",
        error: "OWNER_NOT_REMOVABLE",
      });
    }

    // 通知の文面は削除前の状態で焼き付ける（消えた行は後から読めない）。
    const event = await prisma.event.findUnique({
      where: { id: params.id },
      select: { title: true },
    });
    const removedName = organizerLabel({
      role: target.role,
      displayName: target.displayName,
      user: target.user,
    });

    const lockHolders = [
      ...(target.userId ? [{ lockedByUserId: target.userId }] : []),
      ...(target.guestTokenHash ? [{ lockedByTokenHash: target.guestTokenHash }] : []),
    ];

    const remaining = await prisma.$transaction(async (tx) => {
      if (lockHolders.length > 0) {
        await tx.eventLock.deleteMany({
          where: { eventId: params.id, OR: lockHolders },
        });
      }
      await tx.eventOrganizer.delete({ where: { id: target.id } });
      // 残る幹事は削除後に読む。通知の宛先から外れた本人を除くため。
      return tx.eventOrganizer.findMany({
        where: { eventId: params.id },
        select: { userId: true },
      });
    });

    // 通知はコミット後に作る。失敗しても解除は成立させる（RSVP 通知と同じ扱い）。
    try {
      await notifyCoHostRemoved({
        eventId: params.id,
        eventTitle: event?.title ?? "",
        organizerId: target.id,
        removedUserId: target.userId,
        removedName,
        actorUserId: actor.userId,
        remainingOrganizers: remaining,
      });
    } catch (error) {
      console.error("共同主催の解除通知に失敗しました", error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(
      error,
      `/api/v1/organizer/events/${params.id}/organizers/${params.organizerId}`,
    );
  }
}
