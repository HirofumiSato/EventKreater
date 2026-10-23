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

/**
 * 時刻の言い方を `HH:MM` に寄せる。「19時半」「19時30分」「19じはん」を受ける。
 * 範囲（から・まで）はそのまま残し、抽出側で分ける。
 */
export function normalizeTimeWords(input: string): string {
  let text = input;
  text = text.replace(/(\d{1,2})\s*時\s*半/g, (_, hour: string) => `${hour}:30`);
  text = text.replace(
    /(\d{1,2})\s*時\s*(\d{1,2})\s*分?/g,
    (_, hour: string, minute: string) => `${hour}:${pad2(minute)}`,
  );
  text = text.replace(/(\d{1,2})\s*時/g, (_, hour: string) => `${hour}:00`);
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

const RELATIVE_DAYS: Record<string, number> = { 今日: 0, きょう: 0, 明日: 1, あした: 1, 明後日: 2, あさって: 2 };

/**
 * 発話から日付を取り出す。年が無ければ、今日以降で最も近い同じ月日にする。
 * 今日より前になる月日は翌年として扱う（10 月に「1 月 10 日」と言えば来年）。
 */
export function parseSpokenDate(
  input: string,
  now: Date,
): { year: number; month: number; day: number } | null {
  const text = normalizeSeparators(toHalfWidth(input)).replace(/\s/g, "");

  for (const [word, offset] of Object.entries(RELATIVE_DAYS)) {
    if (!text.includes(word)) continue;
    const base = tokyoYmd(now);
    const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
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

  return null;
}

function resolveYear(
  month: number,
  day: number,
  now: Date,
): { year: number; month: number; day: number } {
  const today = tokyoYmd(now);
  const thisYear = formatYmd(today.year, month, day);
  const todayKey = formatYmd(today.year, today.month, today.day);
  return {
    year: thisYear < todayKey ? today.year + 1 : today.year,
    month,
    day,
  };
}

/** 発話から時刻を取り出す。`normalizeTimeWords` を通した後の文字列を想定する。 */
export function parseSpokenClock(input: string): { hour: number; minute: number } | null {
  const text = normalizeTimeWords(normalizeSeparators(toHalfWidth(input)));
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

/** 開始と終了の範囲表現を分ける。`18:00から20:00` `18:00-20:00` `18:00~20:00`。 */
export function splitTimeRange(input: string): {
  start: string;
  end: string;
} | null {
  const text = normalizeTimeWords(normalizeSeparators(toHalfWidth(input)));
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
