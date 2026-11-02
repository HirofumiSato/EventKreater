/**
 * 画面に出す金額・日付の文字列。同じ見た目を各画面で書き直さないための 1 箇所。
 *
 * ここを直すと全画面の表記が揃う。逆に、画面ごとに違う表記を残したいときは
 * この関数を使わずに画面側で組む（理由をコメントに書く）。
 */

/** 3桁区切りの金額。「3,000円」。0 円も「0円」（無料と言い換えない）。 */
export function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

/** 記号付きの金額。「¥3,000」。単価表のように桁を揃えたい場所で使う。 */
export function yenMark(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

/**
 * 3桁区切りの数字だけ。「2,980」。
 *
 * 「2,980円 / 月」のように単位を小さい字で別に組む場所で使う。`yen()` は「円」まで
 * 返すため、そのまま置くと単位の字が二重になる。桁区切りの規則はここだけに置く。
 */
export function yenDigits(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}`;
}

/**
 * 日時。「2026/10/24 18:30:00」。
 *
 * 端末のタイムゾーンで出す。サーバーの `formatRsvpDeadlineLabel` は日本時間に固定して
 * いるので、締切のように全員で同じ時刻を見せたい場所ではそちらを使う。
 */
export function formatDateTimeJa(value: Date | string): string {
  return new Date(value).toLocaleString("ja-JP");
}

/**
 * 分までの日時。「2026/10/24 18:30」。
 *
 * 一覧の行に添える日時は秒まで要らない。秒が入ると同じ幅で 3 文字ぶん増え、
 * 390px で題や状態の札を押し出す。`formatDateTimeJa` は名簿や期限が使うので、
 * 秒を落とすのはこの関数だけにする。
 */
export function formatDateTimeMinuteJa(value: Date | string): string {
  return new Date(value).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * 日付だけ。「2027/02/03」。
 *
 * 通知の本文のように、期限を 1 文へ収める場所で使う。時刻まで出すと文が長くなり、
 * 390px の通知行で折り返して読めなくなる。日本時間に固定するのは、文面をサーバーで
 * 作ってそのまま保存するため（端末のタイムゾーンで日付が変わってはいけない）。
 */
export function formatDateSlashJa(value: Date | string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/** 保存形式の日付 → 見出し用。「2026-10-22」→「10月22日（木）」。壊れた値はそのまま返す。 */
export function formatDateJa(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}

/**
 * 保存形式の日付 → 年月日と曜日。「2026-11-21」→「2026/11/21（土）」。
 *
 * 告知ページや一覧の「開催日」はこの形で出す。保存形式の `-` をそのまま出すと、
 * 紙の上の日付として読みにくい。壊れた値はそのまま返す。
 */
export function formatDateWithWeekdayJa(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  // 月日は 2 桁のまま出す。`11/8` と `11/08` が混ざると、縦に並べたとき桁が揃わない。
  return `${match[1]}/${match[2]}/${match[3]}（${weekday}）`;
}

/**
 * 保存形式の日付 → 年を含む表記。「2026-11-14」→「2026年11月14日（土）」。
 *
 * チラシのように紙面へ焼く場所で使う。`formatDateJa` は年を落とすため、
 * そのまま使うと利用者が年を知る手がかりが消える。壊れた値はそのまま返す。
 */
export function formatFullDateJa(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[1])}年${formatDateJa(date)}`;
}

/** 保存形式の月 → 見出し用。「2026-10」→「2026年10月」。壊れた値はそのまま返す。 */
export function formatMonthJa(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${Number(match[1])}年${Number(match[2])}月`;
}

/** UTC の年月日から保存形式にする。日を 0 にすると前月の末日になる。 */
export function isoDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/**
 * 日本時間の「今月」を `YYYY-MM-DD` の範囲にする。
 *
 * 端末のタイムゾーンに依存させないため、UTC に 9 時間足してから年月日を読む。
 */
export function currentMonthBounds(now = new Date()): { from: string; to: string } {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { from: isoDate(year, month, 1), to: isoDate(year, month, lastDay) };
}
