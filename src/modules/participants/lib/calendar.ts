import type { CalendarCellItem } from "@/lib/calendar";
import type { ParticipantCalendarEntry } from "@/modules/participants/types";

/**
 * 参加者カレンダーの予定のまとめ。
 * 1つの出欠回答は1つの日付にだけ置く（選んだ日程、無ければイベントの代表日）。
 */

function startTimeKey(entry: ParticipantCalendarEntry): string {
  return entry.eventTime;
}

/**
 * 同じ日の予定を時刻順に並べる。時刻の無いイベントは末尾に置く。
 * 同時刻はイベント名の五十音順にして、読み込むたびに並びが変わらないようにする。
 */
export function sortParticipantDayEntries(
  entries: ParticipantCalendarEntry[],
): ParticipantCalendarEntry[] {
  return [...entries].sort((left, right) => {
    const leftTime = startTimeKey(left);
    const rightTime = startTimeKey(right);
    if (leftTime !== rightTime) {
      if (leftTime === "") return 1;
      if (rightTime === "") return -1;
      return leftTime < rightTime ? -1 : 1;
    }
    const titleOrder = left.event.title.localeCompare(right.event.title, "ja");
    if (titleOrder !== 0) return titleOrder;
    return left.participantId < right.participantId ? -1 : 1;
  });
}

/**
 * セルに出す短冊と、タップしたときのモーダルの中身。
 * 出席は通常の色、欠席は控えめ、参加要望はアンバーにし、どれもイベントページへ進めるようにする。
 */
export function toParticipantCellItem(entry: ParticipantCalendarEntry): CalendarCellItem {
  return {
    key: entry.participantId,
    title: entry.event.title,
    tone:
      entry.status === "DECLINED" ? "muted" : entry.status === "WAITLISTED" ? "waitlist" : "default",
    detail: [
      entry.eventTime || "時刻未定",
      entry.statusLabel,
      entry.event.location,
    ]
      .filter((part) => part !== "")
      .join(" · "),
    href: `/events/${entry.event.id}`,
  };
}

/** 日付ごとに出欠をまとめる。月外の日も含めて返す。 */
export function groupParticipantEntriesByDate(
  entries: ParticipantCalendarEntry[],
): Map<string, ParticipantCalendarEntry[]> {
  const grouped = new Map<string, ParticipantCalendarEntry[]>();
  for (const entry of entries) {
    const sameDay = grouped.get(entry.date);
    if (sameDay) {
      sameDay.push(entry);
    } else {
      grouped.set(entry.date, [entry]);
    }
  }
  for (const [date, sameDay] of grouped) {
    grouped.set(date, sortParticipantDayEntries(sameDay));
  }
  return grouped;
}
