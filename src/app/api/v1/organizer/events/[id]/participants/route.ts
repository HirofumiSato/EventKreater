import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { OrganizerParticipantSchema } from "@/lib/schemas";
import {
  assertCapacityAllows,
  eventOptionsInclude,
  lockEventForCapacity,
  resolveAttendanceChoice,
  resolveDiscountChoice,
} from "@/modules/events/lib/events";
import {
  serializePricePlans,
  serializeSchedules,
  summarizeStatuses,
} from "@/lib/serializers";
import { summarizeRevenue } from "@/modules/revenue/lib/revenue";
import {
  participantRecordInclude,
  participantWaitlistSelect,
  serializeParticipantRow,
} from "@/modules/participants/lib/serialize";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      include: {
        ...eventOptionsInclude,
        // 削除済みも引く。名簿の末尾に薄く出して、元に戻せるようにするため。
        participants: { include: participantRecordInclude },
      },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    // 集計・待ち順・売上は名簿に残っている行だけで数える。削除済みは末尾に並べるだけ。
    const active = event.participants
      .filter((row) => row.deletedAt === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const deleted = event.participants
      .filter((row) => row.deletedAt !== null)
      .sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0));
    const waitlistRows = active.filter((row) => row.status === "WAITLISTED");
    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        capacity: event.capacity,
        schedules: serializeSchedules(event.schedules),
        pricePlans: serializePricePlans(event.pricePlans),
      },
      // 削除済みの件数は絞り込みの札に使う。人数には数えない。
      stats: { ...summarizeStatuses(active), deletedCount: deleted.length },
      // 名簿を開いたついでに売上サマリも出す。内訳は /revenue で見る。
      revenue: summarizeRevenue(active),
      // 未削除（作成順）→ 削除済み（削除した新しい順）。画面はこの順でそのまま並べる。
      participants: [...active, ...deleted].map((row) =>
        serializeParticipantRow(row, waitlistRows),
      ),
    });
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
