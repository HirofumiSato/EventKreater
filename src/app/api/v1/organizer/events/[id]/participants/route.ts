import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { OrganizerParticipantSchema } from "@/lib/schemas";
import {
  assertCapacityAllows,
  lockEventForCapacity,
  resolveAttendanceChoice,
  resolveDiscountChoice,
} from "@/modules/events/lib/events";
import {
  participantRecordInclude,
  participantWaitlistSelect,
  serializeParticipantRow,
} from "@/modules/participants/lib/serialize";
import { loadRoster } from "@/modules/participants/lib/roster";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";
import { revalidatePublicEvent } from "@/modules/events/lib/public-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    // 読み取りは名簿の画面（サーバーコンポーネント）と共有する。
    const data = await loadRoster(params.id);
    if (!data) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }
    return NextResponse.json(data);
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants`);
  }
}

/**
 * 幹事が名簿へ参加者を足す。電話予約や当日の飛び込みを後から入れるための入口。
 *
 * 参加者側の申込（公開 API の POST）と違い、受付状態（`event.status` / `rsvpDeadline`）は見ない。
 * 端末の Cookie は発行せず、照合に使わない使い捨ての `rsvpTokenHash` だけを入れる。
 * 通知（`notifyRsvpSubmitted`）も送らない。幹事自身の操作なので知らせる相手がいない。
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const input = OrganizerParticipantSchema.parse(await req.json());
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

    // 参加要望は席を取らないので 1 人。出席のときだけ人数ぶんの席を使う。
    const partySize = input.status === "ATTENDING" ? (input.partySize ?? 1) : 1;
    const created = await prisma.$transaction(async (tx) => {
      // PATCH の承認と同じく、数えてから書くまでをイベント行のロックで閉じる。
      await lockEventForCapacity(tx, params.id);
      await assertCapacityAllows(tx, params.id, { status: input.status, partySize });
      const choice = await resolveAttendanceChoice(tx, params.id, input);
      const chosen = await resolveDiscountChoice(tx, params.id, input.status, input.discountIds);
      return tx.participant.create({
        data: {
          eventId: params.id,
          // 端末の Cookie は発行しない。照合に使わない使い捨ての値だけ入れる。
          rsvpTokenHash: sha256(generateSecureToken(32)),
          // 幹事が入れた行は会員に紐づけない。同じ人が後から申し込むと別の行として並ぶ。
          userId: null,
          name: input.name,
          status: input.status,
          gender: input.gender ?? null,
          comment: input.comment ? input.comment : null,
          scheduleId: choice.scheduleId,
          partySize,
          pricePlanId: choice.pricePlanId,
          priceAmount: choice.priceAmount,
          pricePlanName: choice.pricePlanName,
          priceAudience: choice.priceAudience,
          waitlistedAt: input.status === "WAITLISTED" ? new Date() : null,
          schedules: { create: choice.scheduleIds.map((scheduleId) => ({ scheduleId })) },
          discounts: { create: chosen.map((row, sortOrder) => ({ ...row, sortOrder })) },
        },
        include: participantRecordInclude,
      });
    });
    // 幹事が足した行も告知ページの人数に出る。次の閲覧から反映する。
    revalidatePublicEvent(params.id);
    // 追加した行は名簿の末尾（未削除の最後）に来る。待ち順も返す。
    const waitlistRows = await prisma.participant.findMany({
      where: { eventId: params.id, status: "WAITLISTED", ...ACTIVE_PARTICIPANT_WHERE },
      select: participantWaitlistSelect,
    });
    return NextResponse.json(
      { participant: serializeParticipantRow(created, waitlistRows) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants`);
  }
}
