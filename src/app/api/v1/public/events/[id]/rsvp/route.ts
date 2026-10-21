import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { isUniqueViolation, ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { SubmitRsvpSchema } from "@/lib/schemas";
import { assertCapacityAllows, assertRsvpOpen, resolveAttendanceChoice } from "@/modules/events/lib/events";
import { RSVP_MAX_AGE, clearCookie, clientIp, rsvpCookieName, writeCookie } from "@/modules/auth/lib/cookies";
import { resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { chooseRsvpTarget, findMyParticipant } from "@/modules/participants/lib/rsvp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

async function loadOpenEvent(eventId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
  });
  if (!event) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "イベントが見つかりません。",
    });
  }
  assertRsvpOpen(event);
  return event;
}

function serializeRsvp(participant: {
  id: string;
  name: string;
  status: "ATTENDING" | "DECLINED";
  gender: "MALE" | "FEMALE" | null;
  comment: string | null;
  scheduleId: string | null;
  pricePlanId: string | null;
}) {
  return {
    id: participant.id,
    name: participant.name,
    status: participant.status,
    gender: participant.gender,
    comment: participant.comment,
    scheduleId: participant.scheduleId,
    pricePlanId: participant.pricePlanId,
  };
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const event = await loadOpenEvent(params.id);
    const input = SubmitRsvpSchema.parse(await req.json());
    const userId = await resolveOptionalUserId(req);
    const cookieName = rsvpCookieName(event.id);
    const existingRaw = req.cookies.get(cookieName)?.value ?? null;
    const tokenHash = existingRaw ? sha256(existingRaw) : null;
    const ipHash = (() => {
      const ip = clientIp(req);
      return ip ? sha256(ip) : null;
    })();

    const submit = () =>
      prisma.$transaction(async (tx) => {
        const found = await findMyParticipant(tx, { eventId: event.id, tokenHash, userId });

        if (found) {
          const { participant: target, stale } = await chooseRsvpTarget(tx, found, userId);
          await assertCapacityAllows(tx, event.id, input.status, target.id);
          const choice = await resolveAttendanceChoice(tx, event.id, input);
          const updated = await tx.participant.update({
            where: { id: target.id },
            data: {
              name: input.name,
              status: input.status,
              gender: input.gender ?? null,
              comment: input.comment ? input.comment : null,
              scheduleId: choice.scheduleId,
              pricePlanId: choice.pricePlanId,
              ipHash,
              // 未ログインで答えた行も、ログイン中の会員に紐づける。
              ...(userId && !target.userId ? { userId } : {}),
            },
          });
          if (stale) await tx.participant.delete({ where: { id: stale.id } });
          // クッキーが残した行を指しているときだけ、そのまま使い続ける。
          const keepCookie = !stale && found.matchedBy === "token" && found.participant.id === target.id;
          return { participant: updated, rawToken: keepCookie ? existingRaw : null, created: false };
        }

        await assertCapacityAllows(tx, event.id, input.status);
        const choice = await resolveAttendanceChoice(tx, event.id, input);
        const rawToken = generateSecureToken(32);
        const created = await tx.participant.create({
          data: {
            eventId: event.id,
            userId,
            rsvpTokenHash: sha256(rawToken),
            name: input.name,
            status: input.status,
            gender: input.gender ?? null,
            comment: input.comment ? input.comment : null,
            scheduleId: choice.scheduleId,
            pricePlanId: choice.pricePlanId,
            ipHash,
          },
        });
        return { participant: created, rawToken, created: true };
      });

    // 同じ会員の同時送信で一意制約に当たったら、1 回だけ「更新」としてやり直す。
    const result = await submit().catch(async (error: unknown) => {
      if (!userId || !isUniqueViolation(error)) throw error;
      return submit();
    });

    const attendingCount = await prisma.participant.count({
      where: { eventId: event.id, status: "ATTENDING" },
    });
    const response = NextResponse.json(
      {
        success: true,
        myRsvp: serializeRsvp(result.participant),
        attendingCount,
      },
      { status: result.created ? 201 : 200 },
    );
    if (result.rawToken) writeCookie(response, req, cookieName, result.rawToken, RSVP_MAX_AGE);
    return response;
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/events/${params.id}/rsvp`);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    const cookieName = rsvpCookieName(event.id);
    const rawToken = req.cookies.get(cookieName)?.value ?? null;
    const userId = await resolveOptionalUserId(req);
    if (!rawToken && !userId) {
      throw new ProblemDetailException({
        status: 401,
        title: "Unauthorized",
        detail: "出欠トークンが見つかりません。",
      });
    }

    const found = await findMyParticipant(prisma, {
      eventId: event.id,
      tokenHash: rawToken ? sha256(rawToken) : null,
      userId,
    });
    if (!found) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "取り消せる出欠回答が見つかりません。",
      });
    }
    // POST と同じ行を消す（会員の行と端末の行が並んでいれば会員の行）。
    const { participant: target, stale } = await chooseRsvpTarget(prisma, found, userId);
    await prisma.participant.delete({ where: { id: target.id } });
    if (stale) await prisma.participant.delete({ where: { id: stale.id } }).catch(() => undefined);

    const attendingCount = await prisma.participant.count({
      where: { eventId: event.id, status: "ATTENDING" },
    });
    const response = NextResponse.json({ success: true, myRsvp: null, attendingCount });
    clearCookie(response, req, cookieName);
    return response;
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/events/${params.id}/rsvp`);
  }
}
