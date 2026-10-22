import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { IssueReceiptSchema } from "@/lib/schemas";
import { serializeReceipt } from "@/modules/receipts/lib/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string; participantId: string };
}

async function loadParticipant(eventId: string, participantId: string) {
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, eventId, event: { isDeleted: false } },
    include: {
      receipt: true,
      event: { select: { title: true } },
    },
  });
  if (!participant) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "参加者が見つかりません。",
    });
  }
  return participant;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const participant = await loadParticipant(params.id, params.participantId);
    if (!participant.receipt) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "この参加者の領収書はまだ発行されていません。",
      });
    }
    return NextResponse.json({
      receipt: serializeReceipt(participant.receipt, participant.event.title),
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants/${params.participantId}/receipt`);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertRegisteredOrganizer(req, params.id);
    const input = IssueReceiptSchema.parse(await req.json());
    const participant = await loadParticipant(params.id, params.participantId);
    if (participant.status !== "ATTENDING") {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail:
          participant.status === "WAITLISTED"
            ? "参加要望中の参加者には領収書を発行できません。先に参加を承認してください。"
            : "欠席の参加者には領収書を発行できません。",
      });
    }

    let issuerName = "主催者";
    if (ctx.userId) {
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { name: true },
      });
      if (user) issuerName = user.name;
    }

    const receipt = await prisma.receipt.upsert({
      where: { participantId: participant.id },
      create: {
        participantId: participant.id,
        eventId: participant.eventId,
        addressee: input.addressee,
        amount: input.amount,
        description: input.description,
        issuerName,
      },
      update: {
        addressee: input.addressee,
        amount: input.amount,
        description: input.description,
        issuerName,
        issuedAt: new Date(),
      },
    });

    return NextResponse.json(
      { receipt: serializeReceipt(receipt, participant.event.title) },
      { status: participant.receipt ? 200 : 201 },
    );
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants/${params.participantId}/receipt`);
  }
}
