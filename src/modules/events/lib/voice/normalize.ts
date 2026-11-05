/**
 * 話された日本語を、フォームの値へ変換しやすい形に寄せる。
 *
 * 漢数字の一括変換はしない。「一般」「一緒」のような語まで数字に変わり、
 * イベント名やプラン名を壊すためである。数字は、単位（円・人・月・日・時）の
 * 直前にあるものだけを、欄ごとの抽出で変換する。
 */

const KANJI_DIGITS: Record<string, number> = {
  "〇": 0,
  "零": 0,
  "一": 1,
  "二": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
};

const KANJI_UNITS: Record<string, number> = { "十": 10, "百": 100, "千": 1000 };

/** 全角の英数字とコロン・空白を半角にする。 */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/\u3000/g, " ");
}

/**
 * 数字に挟まれたダッシュ類だけを半角ハイフンにする。
 * カタカナの長音（コーヒー）を壊さないよう、数字の間だけを対象にする。
 */
export function normalizeSeparators(input: string): string {
  return input.replace(/(\d)\s*[ー―−–—‐]\s*(\d)/g, "$1-$2");
}

/**
 * アラビア数字と漢数字が混ざった表記を数値にする。
 * 「三千」「3千」「千五百」「1万2000」「二十五」を受ける。
 * 数字として読めない文字が混ざっていたら null を返す（誤変換を防ぐ）。
 */
export function parseJapaneseNumber(raw: string): number | null {
  const text = toHalfWidth(raw).replace(/[\s,]/g, "");
  if (text === "") return null;
  if (/^\d+$/.test(text)) return Number(text);

  let total = 0;
  let group = 0;
  let current: number | null = null;
  let sawNumber = false;

  for (const char of text) {
    if (/\d/.test(char)) {
      current = (current ?? 0) * 10 + Number(char);
      sawNumber = true;
      continue;
    }
    const digit = KANJI_DIGITS[char];
    if (digit !== undefined) {
      current = (current ?? 0) * 10 + digit;
      sawNumber = true;
      continue;
    }
    const unit = KANJI_UNITS[char];
    if (unit !== undefined) {
      group += (current ?? 1) * unit;
      current = null;
      sawNumber = true;
      continue;
    }
    if (char === "万") {
      group += current ?? 0;
      total += (group || 1) * 10000;
      group = 0;
      current = null;
      sawNumber = true;
      continue;
    }
    return null;
  }

  if (!sawNumber) return null;
  const value = total + group + (current ?? 0);
  return Number.isFinite(value) ? value : null;
}

/** 単位の直前にある漢数字だけをアラビア数字へ変える。 */
function convertNumbersBeforeUnits(input: string): string {
  return input
    .replace(/([〇零一二三四五六七八九十百]+)\s*(?=年|月|日|時|分|秒|人|名|円)/g, (match) => {
      const value = parseJapaneseNumber(match);
      return value === null ? match : String(value);
    });
}

const pad2 = (value: string | number): string => String(value).padStart(2, "0");

/** 時刻を言わない「朝」「昼」「夜」の既定時刻。 */
const DAY_PART_CLOCKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:お)?昼(?!間)/gu, "12:00"],
  [/(?:朝|あさ)(?!日|食|晩|刊|方|ご)/gu, "09:00"],
  [/(?:夜|晩|よる)(?!中|更|明)/gu, "19:00"],
];

/**
 * 時刻の言い方のうち、朝・昼・夜を 24 時間制の時刻へ寄せる。
 * 「夜7時」は 19 時に、「朝」だけなら 9:00 にする。
 *
 * 時刻の欄だけで使い、`normalizeSpokenText` からは呼ばない。
 * 「夜の部」のような催しの名前を 19:00 に変えないためである。
 */
export function normalizeDayPartWords(input: string): string {
  // 時刻が続くときは、前置きの言葉だけを落とす（「朝9時」→「9時」）。
  let text = input.replace(
    /(?:朝|あさ|昼|ひる|お昼)\s*(?=\d{1,2}\s*(?:時|じ|:|：))/gu,
    "",
  );
  // 「夜7時」「夕方6時」は 12 時間を足す。12 時はそのまま（夜12時＝12:00）。
  text = text.replace(
    /(?:夜|晩|夕方|よる|ゆうがた)\s*(\d{1,2})\s*(?=時|じ|:|：)/gu,
    (match, hour: string) => {
      const value = Number(hour);
      return value >= 1 && value <= 11 ? String(value + 12) : match;
    },
  );
  // 時刻を言わない「朝から」「昼に」「夜は」は、その時刻とみなす。
  for (const [pattern, clock] of DAY_PART_CLOCKS) {
    text = text.replace(pattern, clock);
  }
  return text;
}

/**
 * 時刻の言い方を `HH:MM` に寄せる。「19時半」「19時30分」「19じはん」を受ける。
 * 範囲（から・まで）はそのまま残し、抽出側で分ける。
 *
 * 「2時間」の「時」は時刻ではないため、`(?!間)` で除く
 * （「2時間半」を「2:00間半」に壊さない）。
 */
export function normalizeTimeWords(input: string): string {
  let text = input;
  text = text.replace(/(\d{1,2})\s*時\s*半/g, (_, hour: string) => `${hour}:30`);
  text = text.replace(
    /(\d{1,2})\s*時\s*(\d{1,2})\s*分?/g,
    (_, hour: string, minute: string) => `${hour}:${pad2(minute)}`,
  );
  text = text.replace(/(\d{1,2})\s*時(?!間)/g, (_, hour: string) => `${hour}:00`);
  text = text.replace(/(\d{1,2})\s*じ\s*はん/g, (_, hour: string) => `${hour}:30`);
  text = text.replace(
    /(\d{1,2})\s*じ\s*(\d{1,2})\s*ふん?/g,
    (_, hour: string, minute: string) => `${hour}:${pad2(minute)}`,
  );
  text = text.replace(/(\d{1,2})\s*じ/g, (_, hour: string) => `${hour}:00`);
  return text;
}

const FILLERS = ["えーっと", "えーと", "えっと", "あのー", "あの", "そのー", "うーん", "んー"];

/** 文頭の言いよどみを落とす。 */
export function stripFillers(input: string): string {
  let text = input.trim();
  for (let index = 0; index < 4; index += 1) {
    const filler = FILLERS.find((item) => text.startsWith(item));
    if (!filler) break;
    text = text.slice(filler.length).trim();
  }
  return text;
}

/**
 * 認識結果の前後の空白と、末尾の句読点を落とす。値の変換は parse.ts が持つ。
 *
 * 確認のダイアログにはこの文字列をそのまま出す。「18時。」の句点だけが残ると、
 * 話した言葉をそのまま写したように見えて、入力する値との違いが分かりにくい。
 * 文の途中の句読点は残す（「18時、20時」のような言い方を壊さないため）。
 */
export function cleanTranscript(input: string): string {
  return input
    .replace(/^[\s\u3000]+|[\s\u3000]+$/gu, "")
    .replace(/[。、，．！？!?]+$/u, "")
    .trim();
}

/**
 * 話し言葉を、値として使いやすい形へ寄せる。
 * 句読点と丁寧な語尾（です・ます・で・ね）を落とす。
 */
export function normalizeSpokenText(input: string): string {
  return stripFillers(
    normalizeTimeWords(convertNumbersBeforeUnits(normalizeSeparators(toHalfWidth(input))))
      .replace(/[。、，．！？!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .replace(/(です|でございます|でお願いします|お願いします|ですね|ます)$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 値としての名前を整える。語尾の「で」「という名前」を落とす。 */
export function cleanName(input: string): string {
  return normalizeSpokenText(input)
    .replace(/(という名前|という催し|というイベント)で?$/u, "")
    .replace(/(で|に)する$/u, "")
    .replace(/[「」『』"']/g, "")
    .trim();
}

/** 数字だけを取り出す。郵便番号のように、区切りを無視して桁を数える欄で使う。 */
export function extractDigits(input: string): string {
  return toHalfWidth(input).replace(/[^0-9]/g, "");
}

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間での暦の要素。DB の日付（UTC 0 時）と揃えるために使う。 */
export function tokyoYmd(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + TOKYO_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** `YYYY-MM-DD` を、日本時間の暦として組み立てる。 */
export function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 実在する日付か。2 月 30 日のような入力を弾く。 */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** 日本時間の暦の 1 日。`YYYY-MM-DD` の組み立てに使う。 */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const RELATIVE_DAYS: Record<string, number> = { 今日: 0, きょう: 0, 明日: 1, あした: 1, 明後日: 2, あさって: 2 };

/** 基準日から日数を足した暦。月末・年またぎの繰り上がりは `Date` に任せる。 */
export function addDays(base: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** `YYYY-MM-DD` の文字列を暦として読む。読めなければ null。 */
export function parseYmd(input: string): CalendarDate | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(input.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  return isRealDate(year, month, day) ? { year, month, day } : null;
}

/** 曜日。日曜始まり（`Date#getUTCDay` と同じ並び）。 */
const WEEKDAY_NAMES: Record<string, number> = {
  日曜: 0,
  にちよう: 0,
  月曜: 1,
  げつよう: 1,
  火曜: 2,
  かよう: 2,
  水曜: 3,
  すいよう: 3,
  木曜: 4,
  もくよう: 4,
  金曜: 5,
  きんよう: 5,
  土曜: 6,
  どよう: 6,
};

const WEEKDAY_WORD =
  "(?:日曜日?|月曜日?|火曜日?|水曜日?|木曜日?|金曜日?|土曜日?|にちようび?|げつようび?|かようび?|すいようび?|もくようび?|きんようび?|どようび?)";

const WEEK_PREFIX = "(?:再来週|来週|今週|次の|今度の|さらいしゅう|らいしゅう|こんしゅう)の?";

/** 「日曜日」「どようび」のような語を曜日の番号にする。 */
function weekdayOfWord(word: string): number | null {
  const base = word.replace(/日$/u, "").replace(/び$/u, "");
  return WEEKDAY_NAMES[base] ?? null;
}

/** 暦の曜日。 */
function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * 曜日から次の該当日を決める。
 * - 「次の土曜」「今度の土曜」: 今日より後で最も近い土曜
 * - 「土曜」だけ: 今日以降で最も近い土曜（今日が土曜なら今日）
 * - 「来週の金曜」「再来週の月曜」: 日曜始まりの週で数えたその曜日
 * - 「今週の水曜」: 今週の水曜。今日より前なら翌週へ送る（過去の日付を作らない）
 */
function resolveWeekdayDate(text: string, now: Date): CalendarDate | null {
  const matched = new RegExp(`(${WEEK_PREFIX})?\\s*(${WEEKDAY_WORD})`, "u").exec(text);
  if (!matched) return null;
  const prefix = matched[1] ?? "";
  const target = weekdayOfWord(matched[2]);
  if (target === null) return null;

  const today = tokyoYmd(now);
  const todayKey = formatYmd(today.year, today.month, today.day);
  // 日曜始まりの今週の初め。日曜は 0 なので、そのまま戻ればよい。
  const weekStart = addDays(today, -weekdayOf(today));

  if (/再来週|さらいしゅう/u.test(prefix)) return addDays(weekStart, 14 + target);
  if (/来週|らいしゅう/u.test(prefix)) return addDays(weekStart, 7 + target);
  if (/今週|こんしゅう/u.test(prefix)) {
    const sameWeek = addDays(weekStart, target);
    const key = formatYmd(sameWeek.year, sameWeek.month, sameWeek.day);
    return key < todayKey ? addDays(sameWeek, 7) : sameWeek;
  }

  const delta = (target - weekdayOf(today) + 7) % 7;
  const strict = /次の|今度の/u.test(prefix);
  return addDays(today, delta === 0 && strict ? 7 : delta);
}

const RELATIVE_MONTHS: Record<string, number> = {
  今月: 0,
  こんげつ: 0,
  来月: 1,
  らいげつ: 1,
  再来月: 2,
  さらいげつ: 2,
};

/**
 * 「来月」「再来月」「今月末」「来月末」から暦を決める。
 *
 * 日を言わない「来月」「再来月」は 1 日として扱う（月だけでは日が決まらないため）。
 * 「今月」だけのように日も末も無い言い方は、日が決まらないので読まない
 * （「今月5日」のように日を言ったときだけ、その月のまま受け取る）。
 */
function resolveRelativeMonthDate(text: string, now: Date): CalendarDate | null {
  const matched = /(再来月|来月|今月|さらいげつ|らいげつ|こんげつ)(?:の)?\s*(?:(\d{1,2})\s*日|(末)日?)?/u.exec(
    text,
  );
  if (!matched) return null;
  const offset = RELATIVE_MONTHS[matched[1]];
  if (offset === undefined) return null;

  const base = tokyoYmd(now);
  const total = base.month - 1 + offset;
  const year = base.year + Math.floor(total / 12);
  const month = (total % 12) + 1;

  if (matched[3]) {
    // その月の翌月の 0 日＝その月の末日。
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { year, month, day: lastDay };
  }

  if (matched[2]) {
    const day = Number(matched[2]);
    return isRealDate(year, month, day) ? { year, month, day } : null;
  }

  if (offset === 0) return null;
  return { year, month, day: 1 };
}

/**
 * 月を言わない「5日」を、今日以降で最も近い月日にする。
 * 今日が 10 月 24 日なら「5日」は 11 月 5 日。翌月に無い日（31 日など）は、
 * その日が存在する月まで送る。
 * 「3日前」のような相対表現は日付ではないため、日が前後で終わるときは読まない。
 */
function resolveMonthlessDay(text: string, now: Date): CalendarDate | null {
  const matched = /(\d{1,2})\s*日(?!\s*[前後])/u.exec(text);
  if (!matched) return null;
  const day = Number(matched[1]);
  // 32 日など、どの月にも無い日は読まない。
  if (!isRealDate(2000, 1, day)) return null;

  const base = tokyoYmd(now);
  const todayKey = formatYmd(base.year, base.month, base.day);
  for (let offset = 0; offset < 12; offset += 1) {
    const total = base.month - 1 + offset;
    const year = base.year + Math.floor(total / 12);
    const month = (total % 12) + 1;
    if (!isRealDate(year, month, day)) continue;
    if (formatYmd(year, month, day) >= todayKey) return { year, month, day };
  }
  return null;
}

/**
 * 開催日から逆算するときの日数の差。「前日」は -1、「3日前」は -3、「1週間前」は -7。
 * 日付そのもの（「12月1日」）や、関係のない文は null。
 * 漢数字（「三日前」「一週間前」）も読む。
 */
export function parseRelativeDayOffset(input: string): number | null {
  const text = normalizeSeparators(toHalfWidth(input)).replace(/\s/gu, "");
  if (/前々日/u.test(text)) return -2;
  if (/前日/u.test(text)) return -1;
  if (/当日|同日/u.test(text)) return 0;

  const weeks = /([〇零一二三四五六七八九十百\d]+)週間前/u.exec(text);
  if (weeks) {
    const count = parseJapaneseNumber(weeks[1]);
    return count === null ? null : -count * 7;
  }
  const days = /([〇零一二三四五六七八九十百\d]+)日前/u.exec(text);
  if (days) {
    const count = parseJapaneseNumber(days[1]);
    return count === null ? null : -count;
  }
  return null;
}

/**
 * 発話から日付を取り出す。
 *
 * - 年が無ければ、今日以降で最も近い同じ月日にする。今日より前になる月日は翌年（10 月に「1 月 10 日」なら来年）。
 * - 月を言わなければ、今日以降で最も近い月のその日（「5日」）。
 * - 「来月」「再来月」「今月末」「来月末」は暦の上で決める。
 * - 曜日は「次の土曜」「来週の金曜」のように、次の該当日へ寄せる。
 */
export function parseSpokenDate(input: string, now: Date): CalendarDate | null {
  const text = normalizeSeparators(toHalfWidth(input)).replace(/\s/g, "");

  for (const [word, offset] of Object.entries(RELATIVE_DAYS)) {
    if (!text.includes(word)) continue;
    return addDays(tokyoYmd(now), offset);
  }

  const withYear = /(\d{4})年(\d{1,2})月(\d{1,2})日?/.exec(text);
  if (withYear) {
    const year = Number(withYear[1]);
    const month = Number(withYear[2]);
    const day = Number(withYear[3]);
    return isRealDate(year, month, day) ? { year, month, day } : null;
  }

  const monthDay = /(\d{1,2})月(\d{1,2})日?/.exec(text);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (!isRealDate(2000, month, day)) return null;
    return resolveYear(month, day, now);
  }

  // 「12/5」「12-5」。時刻の `HH:MM` と紛れないよう、コロン形式は見ない。
  const slash = /(\d{1,2})[/-](\d{1,2})(?![\d:])/.exec(text);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    if (!isRealDate(2000, month, day)) return null;
    return resolveYear(month, day, now);
  }

  // 日を数字で言っていれば、その日を優先する（「5日の土曜」）。
  return (
    resolveRelativeMonthDate(text, now) ??
    resolveMonthlessDay(text, now) ??
    resolveWeekdayDate(text, now)
  );
}

function resolveYear(
  month: number,
  day: number,
  now: Date,
): CalendarDate {
  const today = tokyoYmd(now);
  const thisYear = formatYmd(today.year, month, day);
  const todayKey = formatYmd(today.year, today.month, today.day);
  return {
    year: thisYear < todayKey ? today.year + 1 : today.year,
    month,
    day,
  };
}

/** 発話から時刻を取り出す。「19時半」「19:30」「夜7時」「朝から」を受ける。 */
export function parseSpokenClock(input: string): { hour: number; minute: number } | null {
  const text = normalizeTimeWords(
    normalizeDayPartWords(normalizeSeparators(toHalfWidth(input))),
  );
  const matched = /(\d{1,2}):(\d{2})/.exec(text);
  if (!matched) {
    const bare = /^\s*(\d{1,2})\s*$/.exec(text);
    if (!bare) return null;
    const hour = Number(bare[1]);
    return hour >= 0 && hour <= 23 ? { hour, minute: 0 } : null;
  }
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** `HH:mm` に整える。 */
export function formatClock(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * 話された長さを分に変える。「2時間」「2時間半」「1時間30分」「30分」「半時間」を受ける。
 * 時刻ではないため、`normalizeSpokenText` を通した後の文字列を想定する
 * （漢数字は単位の直前だけ変換される。「二時間半」→「2時間半」）。
 */
export function parseSpokenDuration(input: string): number | null {
  const text = normalizeSeparators(toHalfWidth(input));
  const hourAndHalf = /(\d+)\s*時間\s*半/u.exec(text);
  if (hourAndHalf) return Number(hourAndHalf[1]) * 60 + 30;
  const hoursAndMinutes = /(\d+)\s*時間\s*(\d+)\s*分/u.exec(text);
  if (hoursAndMinutes) return Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2]);
  const hours = /(\d+)\s*時間/u.exec(text);
  if (hours) return Number(hours[1]) * 60;
  if (/半\s*時間/u.test(text)) return 30;
  const minutes = /(\d+)\s*分/u.exec(text);
  if (minutes) return Number(minutes[1]);
  return null;
}

/** 開始と終了の範囲表現を分ける。`18:00から20:00` `18:00-20:00` `18:00~20:00`。 */
export function splitTimeRange(input: string): {
  start: string;
  end: string;
} | null {
  const text = normalizeTimeWords(
    normalizeDayPartWords(normalizeSeparators(toHalfWidth(input))),
  );
  const matched = /(\d{1,2}):(\d{2})\s*(?:から|より|~|-|—)\s*(\d{1,2}):(\d{2})/.exec(text);
  if (!matched) return null;
  const startHour = Number(matched[1]);
  const startMinute = Number(matched[2]);
  const endHour = Number(matched[3]);
  const endMinute = Number(matched[4]);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  return {
    start: formatClock(startHour, startMinute),
    end: formatClock(endHour, endMinute),
  };
}
