import type { EventScheduleOption, OrganizerEvent } from "@/modules/events/types";

/**
 * 主催者カレンダーの日付計算。
 *
 * 開催日は `YYYY-MM-DD` の文字列で扱い、`Date.UTC` だけで計算する。
 * ローカルタイムの `new Date("2026-10-22")` は環境によって前日になるため作らない。
 * 表示上の「今日」だけは日本時間で決める。
 */

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日曜始まり。セルの並びと見出しで同じ配列を使う。 */
export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 月の高さを固定する。5週の月と6週の月で、下の一覧が動かないようにする。 */
export const MONTH_GRID_DAYS = 42;

export interface MonthCell {
  /** `YYYY-MM-DD`。 */
  date: string;
  /** その月の日か。月外の日は淡色にし、予定を出さない。 */
  isOutside: boolean;
}

export interface CalendarEntry {
  event: OrganizerEvent;
  schedule: EventScheduleOption;
}

/** 日本時間の「今日」を `YYYY-MM-DD` で返す。 */
export function todayInTokyo(now = new Date()): string {
  return new Date(now.getTime() + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日本時間の「今月」を `YYYY-MM` で返す。 */
export function currentMonth(now = new Date()): string {
  return todayInTokyo(now).slice(0, 7);
}

/** `YYYY-MM` として妥当か。URL のクエリをそのまま信じないために使う。 */
export function isMonthKey(value: string | null | undefined): value is string {
  if (!value) return false;
  const matched = /^(\d{4})-(\d{2})$/.exec(value);
  if (!matched) return false;
  const month = Number(matched[2]);
  return month >= 1 && month <= 12;
}

/** 月を前後に動かす。12月の翌月は翌年1月、1月の前月は前年12月。 */
export function shiftMonth(month: string, delta: number): string {
  if (!isMonthKey(month)) return month;
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const shifted = year * 12 + monthIndex + delta;
  const nextYear = Math.floor(shifted / 12);
  const nextMonth = shifted - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

/** 月初・月末と日数。存在しない日付は作らない。 */
export function monthRange(month: string): { start: string; end: string; days: number } {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(days).padStart(2, "0")}`,
    days,
  };
}

/**
 * 日曜始まりの6週（42日）のセルを作る。
 * 月初の曜日ぶんだけ前月へ戻り、残りは翌月の日で埋める。
 */
export function buildMonthGrid(month: string): MonthCell[] {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const cells: MonthCell[] = [];
  for (let index = 0; index < MONTH_GRID_DAYS; index += 1) {
    const value = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday + index));
    const date = value.toISOString().slice(0, 10);
    cells.push({ date, isOutside: date.slice(0, 7) !== month });
  }
  return cells;
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

/**
 * 同じ日の予定を時刻順に並べる。時刻が無い催しは末尾に置く。
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

/** 選んだ日の予定。無ければ空配列。 */
export function entriesForDate(
  grouped: Map<string, CalendarEntry[]>,
  date: string | null,
): CalendarEntry[] {
  if (!date) return [];
  return grouped.get(date) ?? [];
}

/** 月内の予定が1件も無いか。空状態の出し分けに使う。 */
export function countMonthEntries(grouped: Map<string, CalendarEntry[]>, month: string): number {
  let count = 0;
  for (const [date, entries] of grouped) {
    if (date.slice(0, 7) === month) count += entries.length;
  }
  return count;
}

/** 見出し用。「10月22日（木）」。 */
export function formatDayHeading(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}

/** セルの読み上げ用。「10月22日、予定2件」。 */
export function formatCellLabel(date: string, count: number): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return count > 0 ? `${month}月${day}日、予定${count}件` : `${month}月${day}日、予定なし`;
}
