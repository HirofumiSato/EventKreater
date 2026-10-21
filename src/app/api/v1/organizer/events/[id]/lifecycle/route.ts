import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { LifecycleSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    await assertOwner(req, params.id);
    const input = LifecycleSchema.parse(await req.json());
    const existing = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      select: { id: true },
    });
    if (!existing) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    if (input.action === "close") {
      await prisma.event.update({
        where: { id: existing.id },
        data: { status: "CLOSED" },
      });
      return NextResponse.json({ success: true, status: "CLOSED" });
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
