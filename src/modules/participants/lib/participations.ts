import type { EventStatus, Prisma, PriceAudience, RsvpStatus } from "@prisma/client";
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
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

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
    // 幹事が名簿から外した行は参加履歴に出さない。
    ...ACTIVE_PARTICIPANT_WHERE,
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

/**
 * 参加履歴・カレンダーが使うチラシの列。
 * 画面に出すのはサムネイル（`imageUrl`）だけで、`lqipDataUrl` は作る経路が無い。
 */
const flyerThumbnailSelect = {
  id: true,
  imageUrl: true,
  aspectRatio: true,
} satisfies Prisma.FlyerAssetSelect;

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
  event: {
    include: {
      flyerAsset: { select: flyerThumbnailSelect },
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

/**
 * 参加者カレンダーが読む列だけを引く。
 * 金額・割引・概要・住所はカレンダーに出さないので、`participationInclude` では引かない。
 */
export const calendarEntrySelect = {
  id: true,
  status: true,
  schedule: { select: { eventDate: true, eventTime: true } },
  schedules: {
    select: { schedule: { select: { eventDate: true, eventTime: true, sortOrder: true } } },
  },
  event: {
    select: {
      id: true,
      title: true,
      location: true,
      status: true,
      sortDate: true,
      flyerAsset: { select: flyerThumbnailSelect },
    },
  },
} satisfies Prisma.ParticipantSelect;

/** `calendarEntrySelect` で引いた参加行。 */
export type CalendarEntryRecord = Prisma.ParticipantGetPayload<{
  select: typeof calendarEntrySelect;
}>;

/** カレンダーの 1 件を組むのに要る形。純粋関数なので、テストは素のオブジェクトを渡せる。 */
export interface CalendarEntryRow {
  id: string;
  status: RsvpStatus;
  schedule: { eventDate: Date; eventTime: string } | null;
  schedules?: { schedule: { eventDate: Date; eventTime: string; sortOrder: number } }[];
  event: {
    id: string;
    title: string;
    location: string;
    status: EventStatus;
    sortDate: Date;
    flyerAsset?: { imageUrl: string } | null;
  };
}

/** 参加者カレンダーの 1 件。日付の軸に置く項目だけを返す。 */
export function serializeCalendarEntry(row: CalendarEntryRow): ParticipantCalendarEntry {
  return {
    participantId: row.id,
    date: participationCalendarDate(row),
    eventTime: row.schedule?.eventTime ?? "",
    status: row.status,
    statusLabel: rsvpStatusLabel(row.status),
    event: {
      id: row.event.id,
      title: row.event.title,
      location: row.event.location,
      status: row.event.status,
      flyerThumbnailUrl: row.event.flyerAsset?.imageUrl ?? null,
    },
  };
}

/**
 * 参加者カレンダーの項目。日時を複数選んだ回答は、選んだ日ごとに 1 件返す。
 * 日程を選んでいない回答（欠席など）は、イベントの代表日に 1 件だけ置く。
 */
export function serializeCalendarEntries(row: CalendarEntryRow): ParticipantCalendarEntry[] {
  const schedules = participationSchedules(row);
  if (schedules.length === 0) return [serializeCalendarEntry(row)];
  return schedules.map((schedule) => ({
    participantId: row.id,
    date: formatEventDate(schedule.eventDate),
    eventTime: schedule.eventTime,
    status: row.status,
    statusLabel: rsvpStatusLabel(row.status),
    event: {
      id: row.event.id,
      title: row.event.title,
      location: row.event.location,
      status: row.event.status,
      flyerThumbnailUrl: row.event.flyerAsset?.imageUrl ?? null,
    },
  }));
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * `?month=YYYY-MM` の範囲。日本時間ではなく保存形（UTC 0 時の日付）で切る。
 * `event_schedules.event_date` / `events.sort_date` は日付だけを持つので、UTC の月初で揃える。
 */
export function calendarMonthRange(month: string): { start: Date; end: Date } | null {
  const matched = MONTH_KEY.exec(month);
  if (!matched) return null;
  const year = Number(matched[1]);
  const index = Number(matched[2]) - 1;
  return {
    start: new Date(Date.UTC(year, index, 1)),
    end: new Date(Date.UTC(year, index + 1, 1)),
  };
}

/**
 * 月で絞る条件。カレンダーは「選んだ日程 → 代表日 → イベントの代表日」の順に日付を決めるので、
 * そのどれかが月内に入る回答を残す。
 */
export function calendarMonthFilter(month: string): Prisma.ParticipantWhereInput | null {
  const range = calendarMonthRange(month);
  if (!range) return null;
  const inMonth = { gte: range.start, lt: range.end };
  return {
    OR: [
      // 選んだ日程（join 行）が月内にある。
      { schedules: { some: { schedule: { eventDate: inMonth } } } },
      // join 行が無く、代表日だけを持つ古い回答。
      { schedules: { none: {} }, schedule: { is: { eventDate: inMonth } } },
      // 日程を選んでいない回答（欠席など）。イベントの代表日に置く。
      { schedules: { none: {} }, scheduleId: null, event: { sortDate: inMonth } },
    ],
  };
}
