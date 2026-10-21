import type { EventPricePlanOption, EventScheduleOption, EventStatus, RsvpStatus } from "@/modules/events/types";

/** 参加者ホーム・参加履歴で使う 1 行。API の /api/v1/user/participations と対応する。 */
export interface ParticipationItem {
  id: string;
  name: string;
  status: RsvpStatus;
  comment: string | null;
  scheduleLabel: string | null;
  pricePlanLabel: string | null;
  statusLabel: string;
  receiptId: string | null;
  receiptIssuedAt: string | null;
  answeredAt: string;
  event: {
    id: string;
    title: string;
    sortDate: string;
    schedules: EventScheduleOption[];
    pricePlans: EventPricePlanOption[];
    location: string;
    status: EventStatus;
    flyerThumbnailUrl: string | null;
  };
}

export interface ParticipationSummary {
  attending: number;
  declined: number;
  upcoming: number;
  past: number;
}

export interface ParticipationListResponse {
  items: ParticipationItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  summary: ParticipationSummary;
}

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  ATTENDING: "出席",
  DECLINED: "欠席",
};
