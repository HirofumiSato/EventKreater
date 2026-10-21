import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { resolveUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { rsvpCookieName } from "@/modules/auth/lib/cookies";
import { serializeReceipt } from "@/modules/receipts/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      select: { id: true, title: true },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    const rawToken = req.cookies.get(rsvpCookieName(event.id))?.value;
    if (rawToken) {
      const participant = await prisma.participant.findFirst({
        where: { eventId: event.id, rsvpTokenHash: sha256(rawToken) },
        include: { receipt: true },
      });
      if (participant?.receipt) {
        return NextResponse.json({ receipt: serializeReceipt(participant.receipt, event.title) });
      }
    }

    const userId = await resolveUserId(req);
    if (userId) {
      const participant = await prisma.participant.findFirst({
        where: { eventId: event.id, userId, receipt: { isNot: null } },
        include: { receipt: true },
        orderBy: { updatedAt: "desc" },
      });
      if (participant?.receipt) {
        return NextResponse.json({ receipt: serializeReceipt(participant.receipt, event.title) });
      }
    }

    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "領収書が見つかりません。",
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/events/${params.id}/receipt`);
  }
}
