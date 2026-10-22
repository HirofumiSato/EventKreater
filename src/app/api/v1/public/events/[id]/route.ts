import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { rsvpCookieName } from "@/modules/auth/lib/cookies";
import { collectGuestTokenHashes, resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { findMyParticipant } from "@/modules/participants/lib/rsvp";
import { serializeEvent, serializePublicOrganizerList } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";

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

    let myRsvp: {
      id: string;
      name: string;
      status: "ATTENDING" | "DECLINED";
      gender: "MALE" | "FEMALE" | null;
      comment: string | null;
      scheduleId: string | null;
      pricePlanId: string | null;
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
      location: serialized.location,
      rainPolicy: serialized.rainPolicy,
      capacity: serialized.capacity,
      status: serialized.status,
      visibility: serialized.visibility,
      rsvpDeadline: serialized.rsvpDeadline,
      rsvpOpen: serialized.rsvpOpen,
      attendingCount,
      loggedIn: Boolean(userId),
      /**
       * 勧誘カードの出し分け用。主催者本人（ゲスト幹事の Cookie を含む）と、
       * すでに主催イベントを持つ会員には出さない。
       */
      viewer: {
        loggedIn: Boolean(userId),
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
