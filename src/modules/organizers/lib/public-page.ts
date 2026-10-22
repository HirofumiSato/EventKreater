import { isMonthKey, type CalendarCellItem } from "@/lib/calendar";
import type { EventStatus } from "@/modules/events/types";

/**
 * 主催者の公開ページ（`/organizers/[userId]`）の掲載条件と並び。
 *
 * DB も Next.js も触らない純粋関数にして、API と画面で同じ判定を使う。
 * 日付は `YYYY-MM-DD` の文字列で比べる（`src/lib/calendar.ts` と同じ扱い）。
 */

/** 掲載を判定するのに要る最小限の形。Prisma の行をそのまま渡せる。 */
export interface ListingCandidate {
  status: EventStatus;
  isDeleted: boolean;
  /** 申し込み期限を過ぎていないか。`isRsvpAccepting` の結果を渡す。 */
  rsvpOpen: boolean;
  schedules: { eventDate: string }[];
}

type WithSchedules<S extends { eventDate: string }> = { schedules: S[] };

/** 今日以降の開催日だけを返す。同じ日の複数候補はそのまま残す。 */
export function upcomingSchedules<S extends { eventDate: string }>(
  event: WithSchedules<S>,
  today: string,
): S[] {
  return event.schedules.filter((row) => row.eventDate >= today);
}

/** 次に開催される日。今日以降の候補が無ければ null。 */
export function nextScheduleDate(event: WithSchedules<{ eventDate: string }>, today: string): string | null {
  const dates = upcomingSchedules(event, today).map((row) => row.eventDate);
  if (dates.length === 0) return null;
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

/**
 * 公開ページに載せるか。
 * 下書き・受付停止・期限切れ・削除済み・今日以降の開催日が無いものは載せない。
 * 満員でも載せる（参加要望を受け付けているため）。
 */
export function isPubliclyListed(event: ListingCandidate, today: string): boolean {
  if (event.isDeleted) return false;
  if (event.status !== "PUBLISHED") return false;
  if (!event.rsvpOpen) return false;
  return nextScheduleDate(event, today) !== null;
}

/** 掲載対象だけを、次に開催される日が近い順に並べる。同日は催し名の五十音順。 */
export function sortOrganizerEvents<T extends ListingCandidate & { id: string; title: string }>(
  events: T[],
  today: string,
): T[] {
  return events
    .filter((event) => isPubliclyListed(event, today))
    .sort((left, right) => {
      const leftDate = nextScheduleDate(left, today) ?? "";
      const rightDate = nextScheduleDate(right, today) ?? "";
      if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
      const titleOrder = left.title.localeCompare(right.title, "ja");
      if (titleOrder !== 0) return titleOrder;
      return left.id < right.id ? -1 : 1;
    });
}

export interface OrganizerDayEntry<T, S> {
  event: T;
  schedule: S;
}

/**
 * 開催日ごとに催しをまとめる。催しに複数の候補日があれば、それぞれの日へ置く。
 * 同じ日の並びは時刻順、同時刻は催し名の五十音順。
 */
export function groupOrganizerEventsByDate<
  T extends WithSchedules<S> & { id: string; title: string },
  S extends { eventDate: string; eventTime: string },
>(events: T[], today: string): Map<string, OrganizerDayEntry<T, S>[]> {
  const grouped = new Map<string, OrganizerDayEntry<T, S>[]>();
  for (const event of events) {
    for (const schedule of upcomingSchedules(event, today)) {
      const entry: OrganizerDayEntry<T, S> = { event, schedule };
      const sameDay = grouped.get(schedule.eventDate);
      if (sameDay) {
        sameDay.push(entry);
      } else {
        grouped.set(schedule.eventDate, [entry]);
      }
    }
  }
  for (const [date, sameDay] of grouped) {
    grouped.set(date, sortDayEntries(sameDay));
  }
  return grouped;
}

function sortDayEntries<T extends { id: string; title: string }, S extends { eventTime: string }>(
  entries: OrganizerDayEntry<T, S>[],
): OrganizerDayEntry<T, S>[] {
  return [...entries].sort((left, right) => {
    const leftTime = left.schedule.eventTime;
    const rightTime = right.schedule.eventTime;
    if (leftTime !== rightTime) {
      if (leftTime === "") return 1;
      if (rightTime === "") return -1;
      return leftTime < rightTime ? -1 : 1;
    }
    const titleOrder = left.event.title.localeCompare(right.event.title, "ja");
    if (titleOrder !== 0) return titleOrder;
    return left.event.id < right.event.id ? -1 : 1;
  });
}

/** カレンダーの短冊。満員は参加要望の色にする。 */
export function toOrganizerCellItem(
  entry: OrganizerDayEntry<
    { id: string; title: string; location: string; isFull: boolean; capacity: number | null; attendingCount: number },
    { eventTime: string }
  >,
): CalendarCellItem {
  const { event, schedule } = entry;
  return {
    key: `${event.id}:${schedule.eventTime}`,
    title: event.title,
    tone: event.isFull ? "waitlist" : "default",
    detail: [
      schedule.eventTime || "時刻未定",
      event.location,
      event.capacity !== null ? `${event.attendingCount}/${event.capacity}名` : `${event.attendingCount}名`,
    ]
      .filter((part) => part !== "")
      .join(" · "),
    href: `/events/${event.id}`,
  };
}

/** 今月より前を選ばせない。壊れた値は下限へ寄せる。 */
export function clampMonth(month: string | null | undefined, minMonth: string): string {
  if (!isMonthKey(month)) return minMonth;
  return month < minMonth ? minMonth : month;
}

/** 主催者の公開プロフィールの URL。告知ページの主催者名はここへ送る。 */
export function organizerProfilePath(userId: string): string {
  return `/organizers/${userId}`;
}

/** 主催者の催し（カレンダー・一覧）の URL。プロフィールの下の節に置く。 */
export function organizerEventsPath(userId: string): string {
  return `/organizers/${userId}/events`;
}
