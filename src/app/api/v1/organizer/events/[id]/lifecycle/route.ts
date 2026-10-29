import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { LifecycleSchema } from "@/lib/schemas";
import { assertCanReopenEvent, assertCanStopEvent, reopenEvent } from "@/modules/events/lib/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertOwner(req, params.id);
    const input = LifecycleSchema.parse(await req.json());
    const existing = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    if (input.action === "close") {
      assertCanStopEvent(existing);
      await prisma.event.update({
        where: { id: existing.id },
        data: { status: "CLOSED" },
      });
      return NextResponse.json({ success: true, status: "CLOSED" });
    }

    if (input.action === "reopen") {
      assertCanReopenEvent(existing);
      // 一時停止は枠を空ける。再開はもう一度枠を消費するので、満杯なら 402 で断る。
      await reopenEvent(ctx.userId, existing.id);
      return NextResponse.json({ success: true, status: "PUBLISHED" });
    }

    await prisma.$transaction([
      prisma.eventLock.deleteMany({ where: { eventId: existing.id } }),
      prisma.event.update({ where: { id: existing.id }, data: { isDeleted: true } }),
    ]);
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/lifecycle`);
  }
}
