import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { LifecycleSchema } from "@/lib/schemas";
import { assertCanReopenEvent, assertCanStopEvent, reopenEvent } from "@/modules/events/lib/lifecycle";
import { revalidatePublicEvent } from "@/modules/events/lib/public-event";
import { revalidateOrganizerPagesOfEvent } from "@/modules/organizers/lib/public-organizer";

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
      // 告知ページの札（受付中・受付終了）と出欠の入口が変わる。
      revalidatePublicEvent(existing.id);
      // 主催者の公開ページからも外れる（受付停止は掲載条件を満たさない）。
      await revalidateOrganizerPagesOfEvent(existing.id);
      return NextResponse.json({ success: true, status: "CLOSED" });
    }

    if (input.action === "reopen") {
      assertCanReopenEvent(existing);
      // 一時停止はチケットを空ける。再開はもう一度チケットを消費するので、満杯なら 402 で断る。
      await reopenEvent(ctx.userId, existing.id);
      revalidatePublicEvent(existing.id);
      await revalidateOrganizerPagesOfEvent(existing.id);
      return NextResponse.json({ success: true, status: "PUBLISHED" });
    }

    await prisma.$transaction([
      prisma.eventLock.deleteMany({ where: { eventId: existing.id } }),
      prisma.event.update({ where: { id: existing.id }, data: { isDeleted: true } }),
    ]);
    // 削除したら告知ページは 404 になる。古い本文を返さないよう捨てる。
    revalidatePublicEvent(existing.id);
    // 主催者の公開ページの一覧からも消える。
    await revalidateOrganizerPagesOfEvent(existing.id);
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/lifecycle`);
  }
}
