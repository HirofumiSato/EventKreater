import type { Prisma, PriceAudience, RsvpStatus } from "@prisma/client";
import {
  formatEventDate,
  pricePlanChoiceLabel,
  serializeEvent,
  serializePricePlans,
  serializeSchedules,
} from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";

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
export function serializeParticipation(row: {
  id: string;
  name: string;
  status: RsvpStatus;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  schedule: { eventDate: Date; eventTime: string } | null;
  pricePlan: { name: string; audience: PriceAudience; amount: number; note: string | null } | null;
  receipt: { id: string; issuedAt: Date } | null;
  event: Parameters<typeof serializeEvent>[0];
}) {
  const event = serializeEvent(row.event);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    comment: row.comment,
    scheduleLabel: row.schedule
      ? `${formatEventDate(row.schedule.eventDate)} ${row.schedule.eventTime}`
      : null,
    pricePlanLabel: row.pricePlan ? pricePlanChoiceLabel(row.pricePlan) : null,
    statusLabel: row.status === "ATTENDING" ? "出席" : "欠席",
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
    },
  };
}

export const participationInclude = {
  schedule: true,
  pricePlan: true,
  receipt: { select: { id: true, issuedAt: true } },
  event: {
    include: { flyerAsset: true, ...eventOptionsInclude },
  },
} as const;
