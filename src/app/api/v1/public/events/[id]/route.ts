import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { rsvpCookieName } from "@/modules/auth/lib/cookies";
import { collectGuestTokenHashes, resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { findMyParticipant } from "@/modules/participants/lib/rsvp";
import { serializeEvent, serializeParticipantDiscounts, serializePublicOrganizerList } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";
import { isFull as isFullOf, remainingSeats, waitlistPosition } from "@/modules/events/lib/rsvp-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const event = await prisma.event.findFirst({
      where: {
        id: params.id,
        isDeleted: false,
        status: { in: ["PUBLISHED", "CLOSED"] },
      },
      include: {
        flyerAsset: true,
        ...eventOptionsInclude,
        organizers: {
          select: {
            id: true,
            role: true,
            userId: true,
            displayName: true,
            user: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    const attendingCount = await prisma.participant.count({
      where: { eventId: event.id, status: "ATTENDING" },
    });
    const waitlistRows = await prisma.participant.findMany({
      where: { eventId: event.id, status: "WAITLISTED" },
      select: { id: true, status: true, waitlistedAt: true, createdAt: true },
      orderBy: [{ waitlistedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const waitlistCount = waitlistRows.length;
    const seatsLeft = remainingSeats(event.capacity, attendingCount);
    const eventIsFull = isFullOf(event.capacity, attendingCount);

    let myRsvp: {
      id: string;
      name: string;
      status: "ATTENDING" | "DECLINED" | "WAITLISTED";
      gender: "MALE" | "FEMALE" | null;
      comment: string | null;
      scheduleId: string | null;
      pricePlanId: string | null;
      discounts: ReturnType<typeof serializeParticipantDiscounts>;
      waitlistPosition: number | null;
    } | null = null;
    let myReceipt: {
      id: string;
      addressee: string;
      amount: number;
      description: string;
      issuerName: string;
      issuedAt: string;
    } | null = null;

    const rawToken = req.cookies.get(rsvpCookieName(event.id))?.value;
    const tokenHash = rawToken ? sha256(rawToken) : null;
    // 端末のクッキーが無い・別端末でも、ログインしていれば同じ回答を返す。
    const userId = await resolveOptionalUserId(req);
    // 誰として答えるかの 1 行に出す、ログイン中の会員名。
    const viewerName = userId
      ? (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null
      : null;
    // 告知ページの勧誘カードの出し分け。ゲスト幹事は Cookie で本人と分かるので、JWT だけでは足りない。
    const guestHashes = collectGuestTokenHashes(req, event.id);
    const organizerConditions = [
      ...(userId ? [{ userId }] : []),
      ...(guestHashes.length > 0 ? [{ guestTokenHash: { in: guestHashes } }] : []),
    ];
    const [myOrganizerRow, memberOrganizerCount, guestOwnerCount] = await Promise.all([
      organizerConditions.length > 0
        ? prisma.eventOrganizer.findFirst({
            where: { eventId: event.id, OR: organizerConditions },
            select: { id: true },
          })
        : Promise.resolve(null),
      userId
        ? prisma.eventOrganizer.count({ where: { userId, event: { isDeleted: false } } })
        : Promise.resolve(0),
      // 未登録のまま自分のイベントを1件持つ幹事にも、勧誘カードは出さない。
      // 共同幹事だけの端末は「自分のイベント」を持っていないので、カードを出す。
      guestHashes.length > 0
        ? prisma.eventOrganizer.count({
            where: { guestTokenHash: { in: guestHashes }, role: "OWNER", event: { isDeleted: false } },
          })
        : Promise.resolve(0),
    ]);
    const found = await findMyParticipant(prisma, { eventId: event.id, tokenHash, userId });
    const participant = found
      ? await prisma.participant.findUnique({
          where: { id: found.participant.id },
          select: {
            id: true,
            name: true,
            status: true,
            gender: true,
            comment: true,
            scheduleId: true,
            pricePlanId: true,
            discounts: { orderBy: { sortOrder: "asc" } },
            receipt: true,
          },
        })
      : null;
    if (participant) {
      myRsvp = {
        id: participant.id,
        name: participant.name,
        status: participant.status,
        gender: participant.gender,
        comment: participant.comment,
        scheduleId: participant.scheduleId,
        pricePlanId: participant.pricePlanId,
        discounts: serializeParticipantDiscounts(participant.discounts),
        waitlistPosition: waitlistPosition(waitlistRows, participant.id),
      };
      if (participant.receipt) {
        myReceipt = {
          id: participant.receipt.id,
          addressee: participant.receipt.addressee,
          amount: participant.receipt.amount,
          description: participant.receipt.description,
          issuerName: participant.receipt.issuerName,
          issuedAt: participant.receipt.issuedAt.toISOString(),
        };
      }
    }

    const serialized = serializeEvent(event);
    return NextResponse.json({
      id: serialized.id,
      title: serialized.title,
      sortDate: serialized.sortDate,
      schedules: serialized.schedules,
      pricePlans: serialized.pricePlans,
      discounts: serialized.discounts,
      location: serialized.location,
      rainPolicy: serialized.rainPolicy,
      capacity: serialized.capacity,
      targetGeneration: serialized.targetGeneration,
      themeId: serialized.themeId,
      status: serialized.status,
      visibility: serialized.visibility,
      rsvpDeadline: serialized.rsvpDeadline,
      rsvpOpen: serialized.rsvpOpen,
      attendingCount,
      waitlistCount,
      remainingSeats: seatsLeft,
      isFull: eventIsFull,
      // 満員でも、出欠を受け付けている間は参加要望を受け付ける。
      acceptsWaitlist: eventIsFull && serialized.rsvpOpen,
      loggedIn: Boolean(userId),
      /**
       * 勧誘カードの出し分け用。主催者本人（ゲスト幹事の Cookie を含む）と、
       * すでに主催イベントを持つ会員には出さない。
       */
      viewer: {
        loggedIn: Boolean(userId),
        name: viewerName,
        isThisEventsOrganizer: Boolean(myOrganizerRow),
        hasOrganizerRole: memberOrganizerCount > 0 || guestOwnerCount > 0,
      },
      organizers: serializePublicOrganizerList(event.organizers),
      flyerAsset: serialized.flyerAsset,
      myRsvp,
      myReceipt,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/events/${params.id}`);
  }
}
