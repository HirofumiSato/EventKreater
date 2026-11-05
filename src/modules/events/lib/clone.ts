/**
 * 複製の日付計算。開催日と申込締切を月単位でずらす。
 *
 * 日付は `YYYY-MM-DD` の文字列で扱い、月の計算は `@/lib/calendar` の
 * `shiftMonth` と `monthRange` に任せる（新しい日付計算をここに書かない）。
 * 月末はずらした月の末日へ丸める。1月31日の翌月は2月28日、閏年は2月29日になる。
 * DOM にも Next にも依存しない純ロジックなので、単体テストからそのまま呼べる。
 */

import { isMonthKey, monthRange, shiftMonth } from "@/lib/calendar";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` を months か月ずらす。
 *
 * 月末はずらした月の末日へ丸める（1月31日 → 2月28日、閏年は2月29日）。
 * 形の違う値は計算せず、そのまま返す。
 */
export function shiftDateByMonths(date: string, months: number): string {
  const matched = DATE_PATTERN.exec(date);
  if (!matched) return date;
  const month = `${matched[1]}-${matched[2]}`;
  if (!isMonthKey(month)) return date;
  const shifted = shiftMonth(month, months);
  const { days } = monthRange(shifted);
  const day = Math.min(Number(matched[3]), days);
  return `${shifted}-${String(day).padStart(2, "0")}`;
}
