import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { OrganizerParticipantSchema } from "@/lib/schemas";
import {
  assertCapacityAllows,
  keepDiscountSnapshot,
  keepPriceSnapshot,
  lockEventForCapacity,
  resolveAttendanceChoice,
  resolveDiscountChoice,
} from "@/modules/events/lib/events";
import {
  participantRecordInclude,
  participantWaitlistSelect,
  serializeParticipantRow,
} from "@/modules/participants/lib/serialize";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string; participantId: string };
}

/** 削除済みの行を編集しようとしたときの案内。404 でも理由が分かるようにする。 */
const DELETED_PARTICIPANT_DETAIL = "削除済みの参加者です。名簿に戻してから編集してください。";

async function assertEventExists(eventId: string): Promise<void> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    select: { id: true },
  });
  if (!event) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "イベントが見つかりません。",
    });
  }
}

/** 名簿に残っている行だけを返す。削除済みは名簿に戻してから直してもらう。 */
async function loadActiveParticipant(eventId: string, participantId: string) {
  await assertEventExists(eventId);
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, eventId, ...ACTIVE_PARTICIPANT_WHERE },
  });
  if (participant) return participant;
  const deleted = await prisma.participant.findFirst({
    where: { id: participantId, eventId },
    select: { id: true },
  });
  throw new ProblemDetailException({
    status: 404,
    title: "Not Found",
    detail: deleted ? DELETED_PARTICIPANT_DETAIL : "参加者が見つかりません。",
  });
}

/** 削除済みも含めて返す。DELETE の二重押しを 404 にしないため。 */
async function loadParticipantIncludingDeleted(eventId: string, participantId: string) {
  await assertEventExists(eventId);
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, eventId },
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

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const input = OrganizerParticipantSchema.parse(await req.json());
    const current = await loadActiveParticipant(params.id, params.participantId);
    // 人数は省略されたら今の値を保つ（名前だけの修正で席の数が変わらない）。
    // 出席でなければ人数は持たない。参加要望は席を取らないので、承認したときに名簿で入れる。
    const partySize =
      input.status === "ATTENDING" ? (input.partySize ?? current.partySize) : 1;
    const updated = await prisma.$transaction(async (tx) => {
      // 承認は席を1つ使う。数えてから書くまでを閉じ、他の承認と競合させない。
      await lockEventForCapacity(tx, params.id);
      await assertCapacityAllows(tx, params.id, {
        status: input.status,
        partySize,
        ignoreParticipantId: current.id,
      });
      const choice = await resolveAttendanceChoice(tx, params.id, input);
      const snapshot = keepPriceSnapshot(current, choice);
      /**
       * 割引の扱い。欠席・参加要望に変えたら消す。出席なら、幹事が選び直したときだけ入れ替える。
       * `discountIds` を省略した更新（名前だけの修正）では、参加者が選んだ割引を消さない。
       */
      let discountsData:
        | {
            deleteMany: Record<string, never>;
            create?: {
              discountId: string | null;
              name: string;
              amount: number;
              note: string | null;
              sortOrder: number;
            }[];
          }
        | undefined;
      if (input.status !== "ATTENDING") {
        discountsData = { deleteMany: {} };
      } else if (input.discountIds !== undefined) {
        const chosen = await resolveDiscountChoice(tx, params.id, input.status, input.discountIds);
        const currentDiscounts = await tx.participantDiscount.findMany({
          where: { participantId: current.id },
          select: { discountId: true, name: true, amount: true, note: true },
        });
        const kept = keepDiscountSnapshot(currentDiscounts, chosen);
        discountsData = {
          deleteMany: {},
          create: kept.map((row, sortOrder) => ({
            discountId: row.discountId,
            name: row.name,
            amount: row.amount,
            note: row.note,
            sortOrder,
          })),
        };
      }
      return tx.participant.update({
        where: { id: current.id },
        data: {
          name: input.name,
          status: input.status,
          gender: input.gender ?? current.gender,
          comment: input.comment ? input.comment : null,
          scheduleId: choice.scheduleId,
          partySize,
          pricePlanId: choice.pricePlanId,
          // 選んだ日程は毎回入れ替える。出席でなければ空になる。
          schedules: {
            deleteMany: {},
            create: choice.scheduleIds.map((scheduleId) => ({ scheduleId })),
          },
          // 承認・辞退で要望ではなくなったら、待ち順の時刻を落とす。
          waitlistedAt:
            input.status === "WAITLISTED" ? (current.waitlistedAt ?? new Date()) : null,
          ...snapshot,
          ...(discountsData ? { discounts: discountsData } : {}),
        },
        include: participantRecordInclude,
      });
    });
    const waitlistRows = await prisma.participant.findMany({
      where: { eventId: params.id, status: "WAITLISTED", ...ACTIVE_PARTICIPANT_WHERE },
      select: participantWaitlistSelect,
    });
    return NextResponse.json({
      participant: serializeParticipantRow(updated, waitlistRows),
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants/${params.participantId}`);
  }
}

/**
 * 名簿から外す。行は消さずに論理削除し、名簿の末尾に薄く残す（元に戻せる）。
 *
 * 会員との紐づけ（`userId`）を切り、`rsvpTokenHash` を新しい乱数へ差し替える。
 * こうすると `(event_id, user_id)` の一意制約に当たらず、同じ人がもう一度申し込むと
 * 新しい行として名簿に戻る。削除済みの行をもう一度消しても 404 にせず同じ結果を返す。
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const current = await loadParticipantIncludingDeleted(params.id, params.participantId);
    if (current.deletedAt) {
      return NextResponse.json({
        success: true,
        participant: { id: current.id, deletedAt: current.deletedAt.toISOString() },
      });
    }
    const deletedAt = new Date();
    await prisma.participant.update({
      where: { id: current.id },
      data: {
        deletedAt,
        userId: null,
        rsvpTokenHash: sha256(generateSecureToken(32)),
      },
    });
    return NextResponse.json({
      success: true,
      participant: { id: current.id, deletedAt: deletedAt.toISOString() },
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/participants/${params.participantId}`);
  }
}
