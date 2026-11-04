import {
  cleanName,
  extractDigits,
  formatClock,
  formatYmd,
  normalizeSeparators,
  normalizeSpokenText,
  normalizeTimeWords,
  parseJapaneseNumber,
  parseSpokenClock,
  parseSpokenDate,
  splitTimeRange,
  toHalfWidth,
} from "@/modules/events/lib/voice/normalize";
import type { VoiceContext, VoicePatch } from "@/modules/events/lib/voice/types";
import {
  createPricePlanDraft,
  createScheduleDraft,
  groupPricePlanPairs,
  withGroupName,
  type EventFormValues,
  type PricePlanDraft,
  type RainPolicy,
  type ScheduleDraft,
} from "@/modules/events/types";

/**
 * パッチを当てる行。`context.row` は欄の種類で意味が変わる
 * （日時は `schedules`、プラン名は組、金額・補足は `pricePlans` の index）。
 * 整数でない値は先頭の行として扱う。
 */
function targetRow(context: VoiceContext): number {
  const row = context.row ?? 0;
  return Number.isInteger(row) && row >= 0 ? row : 0;
}

/** 指定した行だけを書き換える。行が無ければ null（別の行を勝手に埋めない）。 */
function schedulePatch(
  value: EventFormValues,
  patch: Partial<ScheduleDraft>,
  row: number,
): VoicePatch | null {
  const rows = value.schedules.length > 0 ? value.schedules : [createScheduleDraft()];
  if (row >= rows.length) return null;
  return {
    schedules: rows.map((item, index) => (index === row ? { ...item, ...patch } : item)),
  };
}

function planPatch(
  value: EventFormValues,
  patch: Partial<PricePlanDraft>,
  row: number,
): VoicePatch | null {
  const rows = value.pricePlans.length > 0 ? value.pricePlans : [createPricePlanDraft()];
  if (row >= rows.length) return null;
  return {
    pricePlans: rows.map((item, index) => (index === row ? { ...item, ...patch } : item)),
  };
}

/** 金額として受け付ける上限。API のバリデーションと同じにする。 */
const MAX_AMOUNT = 9_999_999;

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

/** 雨天時の方針。長い言い方から先に見る（「中止」が「雨天中止」を壊さないように）。 */
const RAIN_POLICY_WORDS: ReadonlyArray<readonly [RainPolicy, readonly string[]]> = [
  ["CANCEL_ON_RAIN", ["雨天中止", "中止", "やめる", "やらない"]],
  ["POSTPONE_ON_RAIN", ["雨天順延", "順延", "延期"]],
  ["INDOOR", ["屋内開催", "屋内", "室内", "建物の中で"]],
  ["RAIN_OR_SHINE", ["雨天決行", "決行", "雨でもやる", "雨でも実施"]],
];

/** 数字の並び。漢数字と桁区切りを含む。 */
const NUMBER_EXPRESSION = "[〇零一二三四五六七八九十百千万0-9０-９,]+";

export function parseVoiceTitle(text: string): VoicePatch | null {
  const title = cleanName(text).slice(0, 100);
  return title ? { title } : null;
}

export function parseVoiceOrganizerName(text: string): VoicePatch | null {
  const name = cleanName(text)
    .replace(/(さん|様|くん|ちゃん)$/u, "")
    .slice(0, 50);
  return name ? { organizerDisplayName: name } : null;
}

export function parseVoiceScheduleDate(text: string, context: VoiceContext): VoicePatch | null {
  const date = parseSpokenDate(text, context.now);
  if (!date) return null;
  return schedulePatch(
    context.value,
    { eventDate: formatYmd(date.year, date.month, date.day) },
    targetRow(context),
  );
}

/**
 * 開始時刻。範囲で話されたら終了時刻も一緒に入れる（ひとつの発話で 2 欄を埋める）。
 * 終了が開始と同時刻になる指定は受け付けない。
 */
export function parseVoiceScheduleStart(text: string, context: VoiceContext): VoicePatch | null {
  const row = targetRow(context);
  const range = splitTimeRange(text);
  if (range) {
    if (range.start === range.end) return null;
    return schedulePatch(context.value, { startTime: range.start, endTime: range.end }, row);
  }
  const clock = parseSpokenClock(text);
  if (!clock) return null;
  const startTime = formatClock(clock.hour, clock.minute);
  const current = context.value.schedules[row];
  if (current?.endTime && current.endTime === startTime) return null;
  return schedulePatch(context.value, { startTime }, row);
}

export function parseVoiceScheduleEnd(text: string, context: VoiceContext): VoicePatch | null {
  const row = targetRow(context);
  const range = splitTimeRange(text);
  const clock = range ? null : parseSpokenClock(text);
  const endTime = range ? range.end : clock ? formatClock(clock.hour, clock.minute) : null;
  if (!endTime) return null;
  const current = context.value.schedules[row];
  if (current?.startTime && current.startTime === endTime) return null;
  return schedulePatch(context.value, { endTime }, row);
}

/**
 * プラン名。男女別は 1 組＝1 プランなので、組の全行へ同じ名前を入れる。
 * `context.row` は組の index。
 */
export function parseVoicePlanName(text: string, context: VoiceContext): VoicePatch | null {
  const name = cleanName(text)
    .replace(/(料金|費用|プラン)$/u, "")
    .trim()
    .slice(0, 50);
  if (!name) return null;
  const rows =
    context.value.pricePlans.length > 0 ? context.value.pricePlans : [createPricePlanDraft()];
  const group = groupPricePlanPairs(rows)[targetRow(context)];
  if (!group) return null;
  return { pricePlans: withGroupName(rows, group, name) };
}

/** 金額。円が付いていればその前を、無ければ数字として読める全体を見る。 */
export function parseVoicePlanAmount(text: string, context: VoiceContext): VoicePatch | null {
  const row = targetRow(context);
  const normalized = normalizeSpokenText(text);
  // 「0円」を部分一致で見ると「3000円」まで無料になる。全体が 0 円のときだけ 0 にする。
  if (/無料|フリー|ただ|タダ/u.test(normalized) || /^0\s*(?:円|えん)$/u.test(normalized)) {
    return planPatch(context.value, { amount: "0" }, row);
  }
  const withYen = new RegExp(`(${NUMBER_EXPRESSION})\\s*(?:円|えん)`).exec(normalized);
  const value = withYen ? parseJapaneseNumber(withYen[1]) : parseJapaneseNumber(normalized);
  if (value === null || !Number.isInteger(value) || value < 0 || value > MAX_AMOUNT) return null;
  return planPatch(context.value, { amount: String(value) }, row);
}

export function parseVoicePlanNote(text: string, context: VoiceContext): VoicePatch | null {
  const note = cleanName(text).slice(0, 100);
  return note ? planPatch(context.value, { note }, targetRow(context)) : null;
}

export function parseVoiceVenueName(text: string): VoicePatch | null {
  const venueName = cleanName(text).slice(0, 150);
  return venueName ? { venueName } : null;
}

export function parseVoicePostalCode(text: string): VoicePatch | null {
  const digits = extractDigits(text);
  return digits.length === 7 ? { postalCode: digits } : null;
}

export function parseVoicePrefecture(text: string): VoicePatch | null {
  const normalized = normalizeSpokenText(text);
  const found = PREFECTURES.find((prefecture) => normalized.includes(prefecture));
  return found ? { prefecture: found } : null;
}

export function parseVoiceCity(text: string): VoicePatch | null {
  const city = cleanName(text).slice(0, 100);
  return city ? { city } : null;
}

export function parseVoiceTown(text: string): VoicePatch | null {
  const town = cleanName(text).slice(0, 100);
  return town ? { town } : null;
}

/** 番地。「1の2の3」のような読みを「1-2-3」に寄せる。 */
export function parseVoiceAddressLine(text: string): VoicePatch | null {
  const addressLine = cleanName(normalizeSeparators(toHalfWidth(text)))
    // 後ろ読みで置き換えると「1の2の3」の最後が残る。次の数字を見て区切る。
    .replace(/(\d)\s*の\s*(?=\d)/g, "$1-")
    .slice(0, 200);
  return addressLine ? { addressLine } : null;
}

export function parseVoiceBuilding(text: string): VoicePatch | null {
  const building = cleanName(text).slice(0, 150);
  return building ? { building } : null;
}

export function parseVoiceRainPolicy(text: string): VoicePatch | null {
  const normalized = normalizeSpokenText(text);
  for (const [policy, words] of RAIN_POLICY_WORDS) {
    if (words.some((word) => normalized.includes(word))) return { rainPolicy: policy };
  }
  return null;
}

/** 定員。「無制限」は null（＝制限なし）として保存する。 */
export function parseVoiceCapacity(text: string): VoicePatch | null {
  const normalized = normalizeSpokenText(text);
  if (/無制限|上限なし|制限なし|なし|無し|決めない/u.test(normalized)) {
    return { capacity: null };
  }
  const withUnit = new RegExp(`(${NUMBER_EXPRESSION})\\s*[名人]`).exec(normalized);
  const value = withUnit ? parseJapaneseNumber(withUnit[1]) : parseJapaneseNumber(normalized);
  if (value === null || !Number.isInteger(value) || value < 1 || value > 100_000) return null;
  return { capacity: value };
}

/** 申し込み期限。時刻を言わなければ 23:59 にする。「なし」は空欄に戻す。 */
export function parseVoiceRsvpDeadline(text: string, context: VoiceContext): VoicePatch | null {
  const normalized = normalizeSpokenText(text);
  if (/なし|無し|ない|設定しない|決めない/u.test(normalized)) {
    return { rsvpDeadline: "" };
  }
  const date = parseSpokenDate(normalized, context.now);
  if (!date) return null;
  const clock = parseSpokenClock(normalizeTimeWords(normalized)) ?? { hour: 23, minute: 59 };
  return {
    rsvpDeadline: `${formatYmd(date.year, date.month, date.day)}T${formatClock(clock.hour, clock.minute)}`,
  };
}
