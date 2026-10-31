import { STATUS_LABELS, type EventScheduleOption, type OrganizerEvent } from "@/modules/events/types";
import type { CalendarCellItem } from "@/lib/calendar";

/**
 * 主催者カレンダーの予定のまとめ。
 * 月・日付の計算は参加者カレンダーと共有するため `@/lib/calendar` に置く。
 */

export {
  MAX_CELL_ITEMS,
  MONTH_GRID_DAYS,
  WEEKDAY_LABELS,
  buildMonthGrid,
  countMonthEntries,
  currentMonth,
  defaultSelectedDate,
  entriesForDate,
  entriesForMonth,
  formatCellLabel,
  formatDayHeading,
  formatMonthTitle,
  isMonthKey,
  monthRange,
  shiftMonth,
  splitCellItems,
  todayInTokyo,
} from "@/lib/calendar";
export type { CalendarCellItem, MonthCell } from "@/lib/calendar";

export interface CalendarEntry {
  event: OrganizerEvent;
  schedule: EventScheduleOption;
}

/**
 * 開催日ごとに予定をまとめる。1イベントに最大8件ある開催日を、すべて別の予定として扱う。
 * 月外の日も含めて返し、表示側で選んだ日だけを取り出す。
 */
export function groupSchedulesByDate(events: OrganizerEvent[]): Map<string, CalendarEntry[]> {
  const grouped = new Map<string, CalendarEntry[]>();
  for (const event of events) {
    for (const schedule of event.schedules) {
      const entries = grouped.get(schedule.eventDate);
      if (entries) {
        entries.push({ event, schedule });
      } else {
        grouped.set(schedule.eventDate, [{ event, schedule }]);
      }
    }
  }
  for (const [date, entries] of grouped) {
    grouped.set(date, sortDayEntries(entries));
  }
  return grouped;
}

function startTimeKey(entry: CalendarEntry): string {
  return entry.schedule.startTime ?? "";
}

/** 予定から開く先。下書きは編集、それ以外は出欠一覧。日別一覧とセルのモーダルで同じ先にする。 */
export function organizerEventHref(event: OrganizerEvent): string {
  return event.status === "DRAFT"
    ? `/organizer/events/${event.id}/edit`
    : `/organizer/events/${event.id}/participants`;
}

/** セルに出す短冊と、タップしたときのモーダルの中身。 */
export function toOrganizerCellItem({ event, schedule }: CalendarEntry): CalendarCellItem {
  return {
    key: `${event.id}-${schedule.id}`,
    title: event.title,
    tone: event.status === "PUBLISHED" ? "default" : "muted",
    detail: [schedule.eventTime || "時刻未定", STATUS_LABELS[event.status], event.role === "CO_HOST" ? "共同主催" : ""]
      .filter((part) => part !== "")
      .join(" · "),
    href: organizerEventHref(event),
  };
}

/**
 * 同じ日の予定を時刻順に並べる。時刻が無いイベントは末尾に置く。
 * 同時刻は作成順にして、読み込むたびに並びが変わらないようにする。
 */
export function sortDayEntries(entries: CalendarEntry[]): CalendarEntry[] {
  return [...entries].sort((left, right) => {
    const leftTime = startTimeKey(left);
    const rightTime = startTimeKey(right);
    if (leftTime !== rightTime) {
      if (leftTime === "") return 1;
      if (rightTime === "") return -1;
      return leftTime < rightTime ? -1 : 1;
    }
    if (left.event.createdAt !== right.event.createdAt) {
      return left.event.createdAt < right.event.createdAt ? -1 : 1;
    }
    return left.event.id < right.event.id ? -1 : 1;
  });
}
