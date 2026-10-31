import {
  parseVoiceAddressLine,
  parseVoiceBuilding,
  parseVoiceCapacity,
  parseVoiceCity,
  parseVoiceOrganizerName,
  parseVoicePlanAmount,
  parseVoicePlanName,
  parseVoicePlanNote,
  parseVoicePostalCode,
  parseVoicePrefecture,
  parseVoiceRainPolicy,
  parseVoiceRsvpDeadline,
  parseVoiceScheduleDate,
  parseVoiceScheduleEnd,
  parseVoiceScheduleStart,
  parseVoiceTitle,
  parseVoiceTown,
  parseVoiceVenueName,
} from "@/modules/events/lib/voice/parse";
import type {
  VoiceField,
  VoiceFieldKey,
  VoiceFieldScope,
  VoicePatch,
} from "@/modules/events/lib/voice/types";
import type { EventFormValues } from "@/modules/events/types";

const hasText = (value: string): boolean => value.trim().length > 0;

/** 先頭の行の id を作る。行が無ければ null（その欄は飛ばす）。 */
function rowDomId(value: EventFormValues, prefix: string, key: string | undefined): string | null {
  return key ? `${prefix}-${key}` : null;
}

/**
 * 巡回する順。画面の上から下、ステップの順に並べる。
 * 空欄だけを対象にするので、埋まっている欄は自動で飛ばされる。
 */
export const VOICE_FIELDS: readonly VoiceField[] = [
  {
    key: "title",
    label: "イベント名",
    step: "basic",
    domId: () => "event-title",
    isEmpty: (value) => !hasText(value.title),
    prompt: "イベント名は？",
    example: "忘年会",
    hint: "イベント名。例: 忘年会、勉強会、音楽ライブ",
    parse: (text) => parseVoiceTitle(text),
  },
  {
    key: "organizerName",
    label: "主催者名",
    step: "basic",
    domId: () => "event-organizer-name",
    isEmpty: (value) => !hasText(value.organizerDisplayName),
    applies: (_value, scope) => scope.showOrganizerName,
    prompt: "公開ページに出す主催者名は？",
    example: "山田 太郎",
    hint: "人の名前。例: 山田太郎",
    parse: (text) => parseVoiceOrganizerName(text),
  },
  {
    key: "scheduleDate",
    label: "開催日",
    step: "basic",
    domId: (value) => rowDomId(value, "schedule-date", value.schedules[0]?.key),
    isEmpty: (value) => !hasText(value.schedules[0]?.eventDate ?? ""),
    prompt: "開催日は？",
    example: "12月5日",
    hint: "日付。例: 12月5日、2026年12月5日",
    parse: (text, context) => parseVoiceScheduleDate(text, context),
  },
  {
    key: "scheduleStart",
    label: "開始時刻",
    step: "basic",
    domId: (value) => rowDomId(value, "schedule-start", value.schedules[0]?.key),
    isEmpty: (value) => !hasText(value.schedules[0]?.startTime ?? ""),
    prompt: "何時に始まる？",
    example: "18時",
    hint: "時刻。例: 18時、18時30分、18時半",
    parse: (text, context) => parseVoiceScheduleStart(text, context),
  },
  {
    key: "scheduleEnd",
    label: "終了時刻",
    step: "basic",
    domId: (value) => rowDomId(value, "schedule-end", value.schedules[0]?.key),
    isEmpty: (value) => !hasText(value.schedules[0]?.endTime ?? ""),
    prompt: "何時に終わる？",
    example: "20時",
    hint: "時刻。例: 20時、21時30分、20時半",
    parse: (text, context) => parseVoiceScheduleEnd(text, context),
  },
  {
    key: "planName",
    label: "費用プランの名前",
    step: "pricing",
    domId: (value) => rowDomId(value, "plan-name", value.pricePlans[0]?.key),
    isEmpty: (value) => !hasText(value.pricePlans[0]?.name ?? ""),
    prompt: "プラン名は？",
    example: "一般",
    hint: "料金プラン名。例: 一般、学生、男性用",
    parse: (text, context) => parseVoicePlanName(text, context),
  },
  {
    key: "planAmount",
    label: "金額",
    step: "pricing",
    domId: (value) => rowDomId(value, "plan-amount", value.pricePlans[0]?.key),
    isEmpty: (value) => !hasText(value.pricePlans[0]?.amount ?? ""),
    prompt: "金額は？",
    example: "3000円",
    hint: "金額。例: 3000円、三千円、無料",
    parse: (text, context) => parseVoicePlanAmount(text, context),
  },
  {
    key: "planNote",
    label: "費用の補足",
    step: "pricing",
    domId: (value) => rowDomId(value, "plan-note", value.pricePlans[0]?.key),
    isEmpty: (value) => !hasText(value.pricePlans[0]?.note ?? ""),
    prompt: "補足は？",
    example: "1ドリンク付",
    hint: "料金の補足。例: 1ドリンク付、学生証が必要",
    parse: (text, context) => parseVoicePlanNote(text, context),
  },
  {
    key: "venueName",
    label: "会場名",
    step: "location",
    domId: () => "event-venue-name",
    isEmpty: (value) => !hasText(value.venueName),
    prompt: "会場は？",
    example: "渋谷ホール",
    hint: "会場名。例: 渋谷ホール、市民センター",
    parse: (text) => parseVoiceVenueName(text),
  },
  {
    key: "postalCode",
    label: "郵便番号",
    step: "location",
    domId: () => "event-postal-code",
    isEmpty: (value) => !hasText(value.postalCode),
    prompt: "郵便番号は？",
    example: "1500001",
    hint: "7桁の郵便番号。例: 1500001、150の0001",
    parse: (text) => parseVoicePostalCode(text),
  },
  {
    key: "prefecture",
    label: "都道府県",
    step: "location",
    domId: () => "event-prefecture",
    isEmpty: (value) => !hasText(value.prefecture),
    prompt: "都道府県は？",
    example: "東京都",
    hint: "都道府県。例: 東京都、大阪府、北海道",
    parse: (text) => parseVoicePrefecture(text),
  },
  {
    key: "city",
    label: "市区町村",
    step: "location",
    domId: () => "event-city",
    isEmpty: (value) => !hasText(value.city),
    prompt: "市区町村は？",
    example: "渋谷区",
    hint: "市区町村。例: 渋谷区、横浜市",
    parse: (text) => parseVoiceCity(text),
  },
  {
    key: "town",
    label: "町域",
    step: "location",
    domId: () => "event-town",
    isEmpty: (value) => !hasText(value.town),
    prompt: "町名は？",
    example: "神宮前",
    hint: "町域。例: 神宮前、中央1丁目",
    parse: (text) => parseVoiceTown(text),
  },
  {
    key: "addressLine",
    label: "番地",
    step: "location",
    domId: () => "event-address-line",
    isEmpty: (value) => !hasText(value.addressLine),
    prompt: "番地は？",
    example: "1-2-3",
    hint: "番地。例: 1-2-3、1の2の3",
    parse: (text) => parseVoiceAddressLine(text),
  },
  {
    key: "building",
    label: "建物名",
    step: "location",
    domId: () => "event-building",
    isEmpty: (value) => !hasText(value.building),
    prompt: "建物名や階数は？",
    example: "○○ビル3階",
    hint: "建物名と階数。例: ○○ビル3階",
    parse: (text) => parseVoiceBuilding(text),
  },
  {
    key: "rainPolicy",
    label: "雨天時の方針",
    step: "location",
    domId: () => "event-rain-policy",
    isEmpty: () => false,
    optional: true,
    applies: (_value, scope) => scope.includeOptional,
    prompt: "雨ならどうする？",
    example: "雨天決行",
    hint: "雨天決行、雨天中止、雨天順延、屋内開催",
    parse: (text) => parseVoiceRainPolicy(text),
  },
  {
    key: "capacity",
    label: "定員",
    step: "capacity",
    domId: () => "event-capacity",
    isEmpty: () => false,
    optional: true,
    applies: (_value, scope) => scope.includeOptional,
    prompt: "定員は？",
    example: "30人",
    hint: "人数。例: 30人、100人、無制限",
    parse: (text) => parseVoiceCapacity(text),
  },
  {
    key: "rsvpDeadline",
    label: "申し込み期限",
    step: "capacity",
    domId: () => "rsvp-deadline",
    isEmpty: () => false,
    optional: true,
    applies: (_value, scope) => scope.includeOptional,
    prompt: "締め切りは？",
    example: "12月1日23時59分",
    hint: "日時。例: 12月1日23時59分、なし",
    parse: (text, context) => parseVoiceRsvpDeadline(text, context),
  },
];

/** API の入力検証に使う欄の一覧。 */
export const VOICE_FIELD_KEYS: readonly VoiceFieldKey[] = VOICE_FIELDS.map((field) => field.key);

export function voiceFieldByKey(key: VoiceFieldKey): VoiceField | null {
  return VOICE_FIELDS.find((field) => field.key === key) ?? null;
}

/** この欄が今の条件で巡回の対象になるか。主催者名のように画面に無い欄を除く。 */
export function appliesToScope(
  field: VoiceField,
  value: EventFormValues,
  scope: VoiceFieldScope,
): boolean {
  if (field.domId(value) === null) return false;
  return field.applies ? field.applies(value, scope) : true;
}

/** 巡回すべき欄か。空欄を埋める。任意欄は指定されたときだけ、まだ触っていないものを見る。 */
export function isFieldNeeded(
  field: VoiceField,
  value: EventFormValues,
  scope: VoiceFieldScope,
): boolean {
  if (!appliesToScope(field, value, scope)) return false;
  if (field.optional) return scope.includeOptional && !scope.touched.has(field.key);
  return field.isEmpty(value);
}

export function voiceFieldOrder(
  value: EventFormValues,
  scope: VoiceFieldScope,
): readonly VoiceField[] {
  return VOICE_FIELDS.filter((field) => appliesToScope(field, value, scope));
}

/** 上から見て最初に埋めるべき欄。全部埋まっていれば null。 */
export function firstNeededField(
  value: EventFormValues,
  scope: VoiceFieldScope,
): VoiceField | null {
  return voiceFieldOrder(value, scope).find((field) => isFieldNeeded(field, value, scope)) ?? null;
}

/**
 * 音声モードを始める欄。
 * 直前に選んでいた入力欄があればそこから、無ければ上から見て最初の空欄から始める。
 * 手で押した欄は、既定で巡回しない任意の欄でも対象にする（`fieldForDomId` と同じ扱い）。
 */
export function startFieldFor(
  value: EventFormValues,
  scope: VoiceFieldScope,
  domId: string | null,
): VoiceField | null {
  const focused = domId ? fieldForDomId(domId, value, scope) : null;
  return focused ?? firstNeededField(value, scope);
}

/** `cursor` の次に埋めるべき欄。後ろに無ければ null（＝音声入力の完了）。 */
export function nextNeededField(
  value: EventFormValues,
  cursor: VoiceFieldKey | null,
  scope: VoiceFieldScope,
): VoiceField | null {
  const order = voiceFieldOrder(value, scope);
  const index = cursor === null ? -1 : order.findIndex((field) => field.key === cursor);
  const start = index < 0 ? 0 : index + 1;
  return order.slice(start).find((field) => isFieldNeeded(field, value, scope)) ?? null;
}

/** ひとつ前の欄。値は消さず、言い直すために戻る。 */
export function previousField(
  value: EventFormValues,
  cursor: VoiceFieldKey,
  scope: VoiceFieldScope,
): VoiceField | null {
  const order = voiceFieldOrder(value, scope);
  const index = order.findIndex((field) => field.key === cursor);
  if (index <= 0) return null;
  return order[index - 1] ?? null;
}

/** フォーカスされた入力欄から、音声の対象を逆引きする。手で直したらカーソルも移る。 */
export function fieldForDomId(
  domId: string,
  value: EventFormValues,
  scope: VoiceFieldScope,
): VoiceField | null {
  const targetable = VOICE_FIELDS.filter((field) => {
    if (field.domId(value) === null) return false;
    // 手で押した欄は、既定で巡回しない任意の欄でも対象にする。
    if (field.optional) return true;
    return field.applies ? field.applies(value, scope) : true;
  });
  return targetable.find((field) => field.domId(value) === domId) ?? null;
}

/** パッチをフォームへ当てる。行の配列はパッチ側が丸ごと持つ。 */
export function applyVoicePatch(value: EventFormValues, patch: VoicePatch): EventFormValues {
  return { ...value, ...patch };
}

/** 認識モデルに渡す語彙のヒント。欄の文脈を絞る。 */
export function voicePromptFor(key: VoiceFieldKey | null): string | null {
  if (!key) return null;
  const field = voiceFieldByKey(key);
  if (!field) return null;
  return `イベント作成フォームの「${field.label}」を1項目だけ話します。${field.hint}。`;
}

/** いま入っている値を、確認文に使える短い文字列にする。 */
export function describeFieldValue(field: VoiceField, value: EventFormValues): string | null {
  switch (field.key) {
    case "title":
      return value.title || null;
    case "organizerName":
      return value.organizerDisplayName || null;
    case "scheduleDate":
      return value.schedules[0]?.eventDate || null;
    case "scheduleStart":
      return value.schedules[0]?.startTime || null;
    case "scheduleEnd":
      return value.schedules[0]?.endTime || null;
    case "planName":
      return value.pricePlans[0]?.name || null;
    case "planAmount":
      return value.pricePlans[0]?.amount ? `${value.pricePlans[0].amount}円` : null;
    case "planNote":
      return value.pricePlans[0]?.note || null;
    case "venueName":
      return value.venueName || null;
    case "postalCode":
      return value.postalCode || null;
    case "prefecture":
      return value.prefecture || null;
    case "city":
      return value.city || null;
    case "town":
      return value.town || null;
    case "addressLine":
      return value.addressLine || null;
    case "building":
      return value.building || null;
    case "rainPolicy":
      return null;
    case "capacity":
      return value.capacity === null ? "無制限" : `${value.capacity}人`;
    case "rsvpDeadline":
      return value.rsvpDeadline || "なし";
  }
}
