import type { Prisma, PriceAudience, RsvpStatus } from "@prisma/client";
import {
  composeDiscountText,
  composeScheduleLabels,
  formatEventDate,
  pricePlanChoiceLabel,
  serializeEvent,
  serializePricePlans,
  serializeSchedules,
} from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";
import { rsvpStatusLabel } from "@/modules/events/lib/rsvp-status";
import { payableAmount } from "@/modules/revenue/lib/revenue";
import type { ParticipantCalendarEntry } from "@/modules/participants/types";

export type ParticipationScope = "all" | "upcoming" | "past";

export interface ParticipationQuery {
  status?: RsvpStatus;
  scope: ParticipationScope;
}

/**
 * 日本時間の「今日」を、@db.Date と同じ UTC 0 時の Date として返す。
 * events.sort_date / event_schedules.event_date は日付だけを持つので、この値と比較する。
 */
export function todayInTokyo(): Date {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function scopeFilter(scope: ParticipationScope, today: Date): Prisma.ParticipantWhereInput {
  if (scope === "all") return {};
  // 代表日は「選んだ日程 → 無ければイベントの最早日程」の順に見る。
  const comparison = scope === "upcoming" ? { gte: today } : { lt: today };
  return {
    OR: [
      { schedule: { is: { eventDate: comparison } } },
      { scheduleId: null, event: { sortDate: comparison } },
    ],
  };
}

export function participationWhere(
  userId: string,
  query: ParticipationQuery,
  today = todayInTokyo(),
): Prisma.ParticipantWhereInput {
  return {
    userId,
    event: { isDeleted: false },
    ...(query.status ? { status: query.status } : {}),
    ...scopeFilter(query.scope, today),
  };
}

/** 参加履歴の 1 行。参加者ホームと履歴画面で同じ形を使う。 */
/** 出席する日時（複数可）。join 行が無い古い回答は代表日の 1 件に戻す。 */
export function participationSchedules(row: {
  schedule: { eventDate: Date; eventTime: string } | null;
  schedules?: { schedule: { eventDate: Date; eventTime: string; sortOrder: number } }[];
}): { eventDate: Date; eventTime: string }[] {
  const chosen = [...(row.schedules ?? [])]
    .sort((left, right) => left.schedule.sortOrder - right.schedule.sortOrder)
    .map((link) => link.schedule);
  if (chosen.length > 0) return chosen;
  return row.schedule ? [row.schedule] : [];
}

/** 参加履歴のラベル。複数日を選んでいれば ` / ` で並べる。 */
export function participationScheduleLabel(row: Parameters<typeof participationSchedules>[0]): string | null {
  return composeScheduleLabels(participationSchedules(row));
}

export function serializeParticipation(row: {
  id: string;
  name: string;
  status: RsvpStatus;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  schedule: { eventDate: Date; eventTime: string } | null;
  schedules?: { schedule: { eventDate: Date; eventTime: string; sortOrder: number } }[];
  /** 自分を含む参加人数。 */
  partySize?: number;
  pricePlan: { name: string; audience: PriceAudience; amount: number; note: string | null } | null;
  /** 申込時に選んだ割引の写し。無ければ空配列。 */
  discounts?: { name: string; amount: number; note: string | null; sortOrder: number }[];
  receipt: { id: string; issuedAt: Date } | null;
  event: Parameters<typeof serializeEvent>[0] & {
    organizers?: { role: string; userId: string | null }[];
  };
}) {
  const event = serializeEvent(row.event);
  // 参加者ホームから主催者の公開ページへ進むための会員ID。ゲスト幹事なら null。
  const ownerUserId = row.event.organizers?.find((organizer) => organizer.role === "OWNER")?.userId ?? null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    comment: row.comment,
    scheduleLabel: participationScheduleLabel(row),
    pricePlanLabel: row.pricePlan ? pricePlanChoiceLabel(row.pricePlan) : null,
    discountLabel:
      (row.discounts ?? []).length > 0
        ? (row.discounts ?? []).map((discount) => composeDiscountText(discount)).join(" / ")
        : null,
    payableAmount: payableAmount({
      priceAmount: row.pricePlan?.amount ?? null,
      discounts: row.discounts ?? [],
      partySize: row.partySize ?? 1,
    }),
    statusLabel: rsvpStatusLabel(row.status),
    receiptId: row.receipt?.id ?? null,
    receiptIssuedAt: row.receipt?.issuedAt.toISOString() ?? null,
    answeredAt: row.updatedAt.toISOString(),
    event: {
      id: event.id,
      title: event.title,
      sortDate: event.sortDate,
      schedules: serializeSchedules(row.event.schedules),
      pricePlans: serializePricePlans(row.event.pricePlans),
      location: event.location,
      status: event.status,
      flyerThumbnailUrl: event.flyerAsset?.imageUrl ?? null,
      /** 主催者の公開ページ。ゲスト幹事のイベントは null。 */
      ownerUserId,
    },
  };
}

export const participationInclude = {
  schedule: true,
  schedules: {
    select: {
      scheduleId: true,
      schedule: { select: { eventDate: true, eventTime: true, sortOrder: true } },
    },
  },
  pricePlan: true,
  discounts: { orderBy: { sortOrder: "asc" } },
  receipt: { select: { id: true, issuedAt: true } },
  event: {
    include: {
      flyerAsset: true,
      ...eventOptionsInclude,
      organizers: { select: { role: true, userId: true } },
    },
  },
} as const;

/** カレンダーに置く日付。選んだ日程を優先し、無ければイベントの代表日を使う。 */
export function participationCalendarDate(row: {
  schedule: { eventDate: Date } | null;
  event: { sortDate: Date };
}): string {
  return formatEventDate(row.schedule?.eventDate ?? row.event.sortDate);
}

/** 参加者カレンダーの 1 件。日付の軸に置く項目だけを返す。 */
export function serializeCalendarEntry(
  row: Parameters<typeof serializeParticipation>[0],
): ParticipantCalendarEntry {
  const base = serializeParticipation(row);
  return {
    participantId: base.id,
    date: participationCalendarDate(row),
    eventTime: row.schedule?.eventTime ?? "",
    status: base.status,
    statusLabel: base.statusLabel,
    event: {
      id: base.event.id,
      title: base.event.title,
      location: base.event.location,
      status: base.event.status,
      flyerThumbnailUrl: base.event.flyerThumbnailUrl,
    },
  };
}

/**
 * 参加者カレンダーの項目。日時を複数選んだ回答は、選んだ日ごとに 1 件返す。
 * 日程を選んでいない回答（欠席など）は、イベントの代表日に 1 件だけ置く。
 */
export function serializeCalendarEntries(
  row: Parameters<typeof serializeParticipation>[0],
): ParticipantCalendarEntry[] {
  const base = serializeParticipation(row);
  const schedules = participationSchedules(row);
  if (schedules.length === 0) return [serializeCalendarEntry(row)];
  return schedules.map((schedule) => ({
    participantId: base.id,
    date: formatEventDate(schedule.eventDate),
    eventTime: schedule.eventTime,
    status: base.status,
    statusLabel: base.statusLabel,
    event: {
      id: base.event.id,
      title: base.event.title,
      location: base.event.location,
      status: base.event.status,
      flyerThumbnailUrl: base.event.flyerThumbnailUrl,
    },
  }));
}
