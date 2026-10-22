/**
 * 月カレンダーの日付計算。主催者カレンダーと参加者カレンダーで共有する。
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

/**
 * 月グリッドのセルに出す予定。
 * セルは狭いので、専用の短い形にして催し名だけを渡す。
 */
export interface CalendarCellItem {
  key: string;
  title: string;
  /** `muted` は欠席や下書きなど控えめに、`waitlist` は参加要望の色で出す。 */
  tone: "default" | "muted" | "waitlist";
  /** タップしたときのモーダルに出す補足（時刻・出欠・場所）。 */
  detail?: string;
  /** 催しページの URL。無ければモーダルにリンクを出さない。 */
  href?: string;
}

/** 1つのセルに並べる予定の数。入りきらない分は「+N」にまとめる。 */
export const MAX_CELL_ITEMS = 3;

/** セルに入れる予定と、入りきらなかった件数に分ける。 */
export function splitCellItems<T>(
  items: T[],
  max = MAX_CELL_ITEMS,
): { visible: T[]; overflow: number } {
  if (items.length <= max) return { visible: items, overflow: 0 };
  // 「+N」も1行使うので、はみ出すときは1件ぶん空けて3行に収める。
  const visible = items.slice(0, max - 1);
  return { visible, overflow: items.length - visible.length };
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

/** 選んだ日の予定。無ければ空配列。 */
export function entriesForDate<T>(grouped: Map<string, T[]>, date: string | null): T[] {
  if (!date) return [];
  return grouped.get(date) ?? [];
}

/** 月内の予定が1件も無いか。空状態の出し分けに使う。 */
export function countMonthEntries<T>(grouped: Map<string, T[]>, month: string): number {
  let count = 0;
  for (const [date, entries] of grouped) {
    if (date.slice(0, 7) === month) count += entries.length;
  }
  return count;
}

/** 月の選択を変えたとき、今日がその月なら今日を、そうでなければ1日を選ぶ。 */
export function defaultSelectedDate(month: string): string {
  const today = todayInTokyo();
  return today.slice(0, 7) === month ? today : `${month}-01`;
}

/** 見出し用。「2026年10月」。 */
export function formatMonthTitle(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
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
