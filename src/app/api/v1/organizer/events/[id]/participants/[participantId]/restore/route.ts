import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { assertCapacityAllows, lockEventForCapacity } from "@/modules/events/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string; participantId: string };
}

/**
 * 名簿から外した参加者を戻す。
 *
 * 出席の行を戻すと席を使うため、承認と同じく定員を数え直す（埋まっていれば 409 `CAPACITY_REACHED`）。
 * 削除のときに切った会員との紐づけ（`userId`）は戻さない。同じ人がもう一度申し込めば別の行になる。
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      select: { id: true },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    const restored = await prisma.$transaction(async (tx) => {
      // 席を数えてから戻すまでをイベント行のロックで閉じる。
      await lockEventForCapacity(tx, params.id);
      // ロックの内側で読み直す。直前の出欠の変更や別の復元と競合しないようにする。
      const current = await tx.participant.findFirst({
        where: { id: params.participantId, eventId: params.id },
      });
      if (!current) {
        throw new ProblemDetailException({
          status: 404,
          title: "Not Found",
          detail: "参加者が見つかりません。",
        });
      }
      if (!current.deletedAt) {
        throw new ProblemDetailException({
          status: 409,
          title: "Conflict",
          detail: "この参加者は削除されていません。",
        });
      }
      // 削除中は定員に数えていない。戻すときだけ席を確かめる。
      await assertCapacityAllows(tx, params.id, {
        status: current.status,
        partySize: current.partySize,
      });
      return tx.participant.update({
        where: { id: current.id },
        data: { deletedAt: null },
      });
    });

    return NextResponse.json({
      success: true,
      participant: { id: restored.id, deletedAt: null },
    });
  } catch (error) {
    return toErrorResponse(
      error,
      `/api/v1/organizer/events/${params.id}/participants/${params.participantId}/restore`,
    );
  }
}
