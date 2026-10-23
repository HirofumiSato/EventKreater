import { formatDayHeading } from "@/lib/calendar";

/**
 * 共有本文に載せる日時。先頭の1件だけを出し、2件目以降は件数にまとめる。
 * 告知ページの OGP が日時と場所を別に出すため、本文は短く保つ。
 */
export function shareScheduleLabel(
  schedules: readonly { eventDate: string; eventTime: string }[],
): string {
  const first = schedules[0];
  if (!first) return "";
  const head = [formatDayHeading(first.eventDate), first.eventTime.trim()]
    .filter((part) => part !== "")
    .join(" ");
  return schedules.length > 1 ? `${head} ほか${schedules.length - 1}件` : head;
}

export interface ShareTextInput {
  title: string;
  schedules: readonly { eventDate: string; eventTime: string }[];
  location: string;
  /** 告知ページの絶対 URL。 */
  url: string;
}

/**
 * LINE に貼る本文。題名・日時・場所・URL を1行ずつ並べ、空の項目は行ごと落とす。
 * URL は末尾に1回だけ入れる。本文にも入れると、プレビューのカードと二重に見える。
 */
export function buildShareText(input: ShareTextInput): string {
  return [
    input.title.trim(),
    shareScheduleLabel(input.schedules),
    input.location.trim(),
    input.url.trim(),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/**
 * LINE の「送信先を選択」画面を開く URL。
 * パーセントエンコードしないと、改行・`&`・`?` で本文が切れる。
 * `line://` は乗っ取り攻撃の対策で非推奨のため使わない。
 */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

/** 告知ページのパスから、本文に載せる絶対 URL を作る。 */
export function absoluteShareUrl(path: string, origin: string): string {
  return new URL(path, origin).toString();
}
