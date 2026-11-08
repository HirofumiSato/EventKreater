import type { Prisma } from "@prisma/client";
import {
  composeScheduleLabels,
  formatEventDate,
  formatEventDateLabel,
  participantPriceDisplay,
  serializeParticipantDiscounts,
} from "@/lib/serializers";
import type { ParticipantRow } from "@/modules/events/types";
import { waitlistPosition } from "@/modules/events/lib/rsvp-status";
import { participantScheduleIds } from "@/modules/participants/lib/rsvp";
import { discountTotal, payableAmount, unitPayableAmount } from "@/modules/revenue/lib/revenue";

/**
 * 名簿の 1 行を組み立てるために引く関連。
 * 名簿の GET・PATCH・追加の POST が同じ形を返すよう、ここ 1 か所で持つ。
 */
export const participantRecordInclude = {
  schedule: true,
  pricePlan: true,
  discounts: { orderBy: { sortOrder: "asc" as const } },
  schedules: {
    select: {
      scheduleId: true,
      schedule: { select: { eventDate: true, eventTime: true, sortOrder: true } },
    },
  },
} satisfies Prisma.ParticipantInclude;

/** `participantRecordInclude` で引いた参加者行。 */
export type ParticipantRecord = Prisma.ParticipantGetPayload<{
  include: typeof participantRecordInclude;
}>;

/** 待ち順を数えるために引く行。名簿の 3 経路で同じ形を使う。 */
export const participantWaitlistSelect = {
  id: true,
  status: true,
  waitlistedAt: true,
  createdAt: true,
} as const satisfies Prisma.ParticipantSelect;

export type ParticipantWaitlistRow = Prisma.ParticipantGetPayload<{
  select: typeof participantWaitlistSelect;
}>;

/**
 * 名簿の 1 行。GET・PATCH・追加の POST で同じ JSON の形を返す。
 *
 * `waitlistPosition` は同じイベントの未削除の参加要望（`WAITLISTED`）の中で数えるため、
 * 呼び出し側で引いた行を渡す。ここで DB を読み直すと 1 行ごとに問い合わせてしまう。
 */
export function serializeParticipantRow(
  row: ParticipantRecord,
  waitlistRows: readonly ParticipantWaitlistRow[],
): ParticipantRow {
  const price = participantPriceDisplay(row);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    gender: row.gender,
    comment: row.comment,
    scheduleId: row.scheduleId,
    scheduleIds: participantScheduleIds(row.schedules, row.scheduleId),
    partySize: row.partySize,
    pricePlanId: row.pricePlanId,
    // 選んだ全日程を出す。古い回答は代表の 1 件に戻す。
    scheduleLabel:
      row.schedules.length > 0
        ? composeScheduleLabels(row.schedules.map((link) => link.schedule))
        : row.schedule
          ? `${formatEventDateLabel(formatEventDate(row.schedule.eventDate))} ${row.schedule.eventTime}`
          : null,
    pricePlanLabel: price.label,
    pricePlanAmount: price.amount,
    discounts: serializeParticipantDiscounts(row.discounts),
    discountAmount: discountTotal(row.discounts) * row.partySize,
    payableAmount: payableAmount({
      priceAmount: price.amount,
      discounts: row.discounts,
      partySize: row.partySize,
    }),
    // 集金は 1 人ずつ記録する。目安は人数を掛けない 1 人ぶんにする。
    unitPayableAmount: unitPayableAmount({
      priceAmount: price.amount,
      discounts: row.discounts,
    }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    waitlistedAt: row.waitlistedAt ? row.waitlistedAt.toISOString() : null,
    waitlistPosition: waitlistPosition([...waitlistRows], row.id),
    collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
