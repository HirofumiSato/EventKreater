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
    /** 主催者の公開ページに使う会員ID。ゲスト幹事の催しは null。 */
    ownerUserId: string | null;
  };
}

/** 参加者カレンダーの 1 件。API の /api/v1/user/calendar と対応する。 */
export interface ParticipantCalendarEntry {
  participantId: string;
  /**
   * 出欠で選んだ日程の日付。日程を選んでいなければイベントの代表日。
   * `YYYY-MM-DD`。
   */
  date: string;
  /** 選んだ日程の表示用時刻。「18:00〜翌2:00」を含む。空なら時刻未定。 */
  eventTime: string;
  status: RsvpStatus;
  statusLabel: string;
  event: {
    id: string;
    title: string;
    location: string;
    status: EventStatus;
    flyerThumbnailUrl: string | null;
  };
}

export interface ParticipantCalendarResponse {
  items: ParticipantCalendarEntry[];
}

export interface ParticipationSummary {
  attending: number;
  declined: number;
  /** 参加要望中。参加人数にも欠席にも数えない。 */
  waitlisted: number;
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
  WAITLISTED: "参加要望中",
};
