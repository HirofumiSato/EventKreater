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
  VoiceSlot,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";
import {
  groupPricePlanPairs,
  pricingModeOf,
  type EventFormValues,
  type PriceAudience,
} from "@/modules/events/types";

const hasText = (value: string): boolean => value.trim().length > 0;

/** 行の入力欄の id を作る。行が無ければ null（その欄は飛ばす）。 */
function rowDomId(prefix: string, key: string | undefined): string | null {
  return key ? `${prefix}-${key}` : null;
}

/**
 * 行を付けた欄の名前。「2件目の開催日」「女性の金額」など。
 *
 * 費用プランの金額と補足は、画面の並び（男性用・女性用の順に組を作る）から
 * 行の性別を決める。`audience` を渡せばそれを優先する（画面は値を持っているため）。
 * `prompt.ts` は値を持たないので、この決め方だけを手掛かりにする。
 */
export function voiceFieldLabel(
  key: VoiceFieldKey,
  row: number,
  audience?: PriceAudience,
): string {
  const nth = `${row + 1}件目`;
  switch (key) {
    case "scheduleDate":
      return row <= 0 ? "開催日" : `${nth}の開催日`;
    case "scheduleStart":
      return row <= 0 ? "開始時刻" : `${nth}の開始時刻`;
    case "scheduleEnd":
      return row <= 0 ? "終了時刻" : `${nth}の終了時刻`;
    case "planName":
      return row <= 0 ? "費用プランの名前" : `${row + 1}組目のプラン名`;
    case "planAmount":
      return audience
        ? planAudienceLabel("金額", audience, row)
        : priceRowLabel("金額", row);
    case "planNote":
      return audience
        ? planAudienceLabel("費用の補足", audience, row)
        : priceRowLabel("費用の補足", row);
    default:
      return voiceFieldByKey(key)?.label ?? key;
  }
}

/** 男女別の行の名前。共通（ANY）の行は行の番号で呼ぶ。 */
function planAudienceLabel(
  base: string,
  audience: PriceAudience,
  row: number,
): string {
  if (audience === "MALE") return `男性の${base}`;
  if (audience === "FEMALE") return `女性の${base}`;
  return row <= 0 ? base : `${row + 1}件目の${base}`;
}

/**
 * 値を持たない側（`prompt.ts`）の呼び方。男女別の並びは男性用・女性用の順なので、
 * 奇数行を女性用とみなす。共通の費用が 2 件以上あるときは言い方が変わるが、
 * 欄の名前は当て字の手掛かりでしかないため、行の番号だけで十分とする。
 */
function priceRowLabel(base: string, row: number): string {
  if (row <= 0) return base;
  return row % 2 === 1 ? `女性の${base}` : `男性の${base}`;
}

/**
 * 巡回する順。画面の上から下、ステップの順に並べる。
 * 空欄だけを対象にするので、埋まっている欄は自動で飛ばされる。
 *
 * これは定義の一覧で、行の展開は `voiceFieldOrder` が行う。
 * `label` は行を持たないときの名前である。
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
    labelFor: (_value, row) => voiceFieldLabel("scheduleDate", row),
    domId: (value, row) => rowDomId("schedule-date", value.schedules[row]?.key),
    isEmpty: (value, row) => !hasText(value.schedules[row]?.eventDate ?? ""),
    prompt: "開催日は？",
    example: "12月5日",
    hint: "日付。例: 12月5日、2026年12月5日",
    parse: (text, context) => parseVoiceScheduleDate(text, context),
  },
  {
    key: "scheduleStart",
    label: "開始時刻",
    step: "basic",
    labelFor: (_value, row) => voiceFieldLabel("scheduleStart", row),
    domId: (value, row) => rowDomId("schedule-start", value.schedules[row]?.key),
    isEmpty: (value, row) => !hasText(value.schedules[row]?.startTime ?? ""),
    prompt: "何時に始まる？",
    example: "18時",
    hint: "時刻。例: 18時、18時30分、18時半",
    parse: (text, context) => parseVoiceScheduleStart(text, context),
  },
  {
    key: "scheduleEnd",
    label: "終了時刻",
    step: "basic",
    labelFor: (_value, row) => voiceFieldLabel("scheduleEnd", row),
    domId: (value, row) => rowDomId("schedule-end", value.schedules[row]?.key),
    isEmpty: (value, row) => !hasText(value.schedules[row]?.endTime ?? ""),
    prompt: "何時に終わる？",
    example: "20時",
    hint: "時刻。例: 20時、21時30分、20時半",
    parse: (text, context) => parseVoiceScheduleEnd(text, context),
  },
  {
    key: "planName",
    label: "費用プランの名前",
    step: "pricing",
    labelFor: (_value, row) => voiceFieldLabel("planName", row),
    // 男女別は 1 組＝1 プランなので、名前の欄は組の先頭の行の id を返す。
    domId: (value, row) =>
      rowDomId("plan-name", groupPricePlanPairs(value.pricePlans)[row]?.[0]?.key),
    isEmpty: (value, row) =>
      !hasText(groupPricePlanPairs(value.pricePlans)[row]?.[0]?.name ?? ""),
    prompt: "プラン名は？",
    example: "一般",
    hint: "料金プラン名。例: 一般、学生、男性用",
    parse: (text, context) => parseVoicePlanName(text, context),
  },
  {
    key: "planAmount",
    label: "金額",
    step: "pricing",
    labelFor: (value, row) =>
      voiceFieldLabel("planAmount", row, value.pricePlans[row]?.audience),
    domId: (value, row) => rowDomId("plan-amount", value.pricePlans[row]?.key),
    isEmpty: (value, row) => !hasText(value.pricePlans[row]?.amount ?? ""),
    prompt: "金額は？",
    example: "3000円",
    hint: "金額。例: 3000円、三千円、無料",
    parse: (text, context) => parseVoicePlanAmount(text, context),
  },
  {
    key: "planNote",
    label: "費用の補足",
    step: "pricing",
    labelFor: (value, row) =>
      voiceFieldLabel("planNote", row, value.pricePlans[row]?.audience),
    domId: (value, row) => rowDomId("plan-note", value.pricePlans[row]?.key),
    isEmpty: (value, row) => !hasText(value.pricePlans[row]?.note ?? ""),
    // 画面でも「補足（任意）」。空欄のまま次へ進めるので、聞くのは 1 度だけにする。
    optional: true,
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

/** 1 つの欄と行から、巡回する 1 マスを作る。その行の入力欄が無ければ null。 */
function makeSlot(field: VoiceField, value: EventFormValues, row: number): VoiceSlot | null {
  if (field.domId(value, row) === null) return null;
  const label = field.labelFor?.(value, row) ?? field.label;
  return {
    id: `${field.key}:${row}` as VoiceSlotId,
    key: field.key,
    row,
    label,
    prompt: label === field.label ? field.prompt : `${label}は？`,
    step: field.step,
    field,
    domId: (next) => field.domId(next, row),
  };
}

/**
 * 行を展開したすべてのマス。スコープでは絞らない。
 * 並びは `title` → `organizerName` → 日時（行ごと）→ 費用（組ごとの名前、組の行ごとの金額・補足）
 * → 場所 → 定員・期限（任意）。
 */
function allSlots(value: EventFormValues): VoiceSlot[] {
  const slots: VoiceSlot[] = [];
  const add = (key: VoiceFieldKey, row: number) => {
    const field = voiceFieldByKey(key);
    if (!field) return;
    const slot = makeSlot(field, value, row);
    if (slot) slots.push(slot);
  };

  add("title", 0);
  add("organizerName", 0);
  value.schedules.forEach((_row, index) => {
    add("scheduleDate", index);
    add("scheduleStart", index);
    add("scheduleEnd", index);
  });
  // 名前は組に 1 つ、金額と補足は行ごとに 1 つ。男女別では 1 組が 2 行になる。
  groupPricePlanPairs(value.pricePlans).forEach((group, groupIndex) => {
    add("planName", groupIndex);
    for (const row of group) {
      const index = value.pricePlans.indexOf(row);
      if (index < 0) continue;
      add("planAmount", index);
      add("planNote", index);
    }
  });
  add("venueName", 0);
  add("postalCode", 0);
  add("prefecture", 0);
  add("city", 0);
  add("town", 0);
  add("addressLine", 0);
  add("building", 0);
  add("rainPolicy", 0);
  add("capacity", 0);
  add("rsvpDeadline", 0);
  return slots;
}

/** この欄・行が今の条件で巡回の対象になるか。主催者名のように画面に無い欄を除く。 */
export function appliesToScope(
  field: VoiceField,
  value: EventFormValues,
  scope: VoiceFieldScope,
  row = 0,
): boolean {
  if (field.domId(value, row) === null) return false;
  return field.applies ? field.applies(value, scope) : true;
}

/** 巡回すべき欄か。空欄を埋める。任意欄は指定されたときだけ、まだ触っていないものを見る。 */
export function isFieldNeeded(
  field: VoiceField,
  value: EventFormValues,
  scope: VoiceFieldScope,
  row = 0,
): boolean {
  if (!appliesToScope(field, value, scope, row)) return false;
  if (field.optional) return scope.includeOptional && !scope.touched.has(field.key);
  return field.isEmpty(value, row);
}

/** マスが巡回の対象か。 */
export function isSlotNeeded(
  slot: VoiceSlot,
  value: EventFormValues,
  scope: VoiceFieldScope,
): boolean {
  return isFieldNeeded(slot.field, value, scope, slot.row);
}

/**
 * 費用の最初（プラン名）へ入る直前に、男女別を聞くか。
 *
 * 金額を聞いたあとではなく、費用の入口で聞く。男女別にすると行が増えるため、
 * プラン名から金額へ進む流れを 1 回だけ作り直せる入口で尋ねるのが分かりやすい。
 * 全部が共通（ANY）のときだけ聞く。男女別の行が 1 つでもあれば、もう聞かない。
 */
export function shouldAskGenderBeforePricing(value: EventFormValues): boolean {
  return value.pricePlans.length > 0 && pricingModeOf(value.pricePlans) === "COMMON";
}

/** 巡回するマスの並び。行とスコープで絞ったもの。 */
export function voiceFieldOrder(
  value: EventFormValues,
  scope: VoiceFieldScope,
): readonly VoiceSlot[] {
  return allSlots(value).filter((slot) => appliesToScope(slot.field, value, scope, slot.row));
}

/** 上から見て最初に埋めるべきマス。全部埋まっていれば null。 */
export function firstNeededField(
  value: EventFormValues,
  scope: VoiceFieldScope,
): VoiceSlot | null {
  return voiceFieldOrder(value, scope).find((slot) => isSlotNeeded(slot, value, scope)) ?? null;
}

/**
 * 音声モードを始めるマス。
 * 直前に選んでいた入力欄があればそこから、無ければ上から見て最初の空欄から始める。
 * 手で押した欄は、既定で巡回しない任意の欄でも対象にする（`fieldForDomId` と同じ扱い）。
 */
export function startFieldFor(
  value: EventFormValues,
  scope: VoiceFieldScope,
  domId: string | null,
): VoiceSlot | null {
  const focused = domId ? fieldForDomId(domId, value, scope) : null;
  return focused ?? firstNeededField(value, scope);
}

/** `cursor` の次に埋めるべきマス。後ろに無ければ null（＝音声入力の完了）。 */
export function nextNeededField(
  value: EventFormValues,
  cursor: VoiceSlotId | null,
  scope: VoiceFieldScope,
): VoiceSlot | null {
  const order = voiceFieldOrder(value, scope);
  const index = cursor === null ? -1 : order.findIndex((slot) => slot.id === cursor);
  const start = index < 0 ? 0 : index + 1;
  return order.slice(start).find((slot) => isSlotNeeded(slot, value, scope)) ?? null;
}

/** ひとつ前のマス。値は消さず、言い直すために戻る。行をまたいでも 1 つずつ戻る。 */
export function previousField(
  value: EventFormValues,
  cursor: VoiceSlotId,
  scope: VoiceFieldScope,
): VoiceSlot | null {
  const order = voiceFieldOrder(value, scope);
  const index = order.findIndex((slot) => slot.id === cursor);
  if (index <= 0) return null;
  return order[index - 1] ?? null;
}

/** カーソルの id からマスを引き直す。行が消えた・任意欄を外した場合も定義から戻す。 */
export function voiceSlotById(
  id: VoiceSlotId,
  value: EventFormValues,
  scope: VoiceFieldScope,
): VoiceSlot | null {
  const ordered = voiceFieldOrder(value, scope).find((slot) => slot.id === id);
  if (ordered) return ordered;
  return allSlots(value).find((slot) => slot.id === id) ?? null;
}

/** フォーカスされた入力欄から、音声の対象を逆引きする。手で直したらカーソルも移る。 */
export function fieldForDomId(
  domId: string,
  value: EventFormValues,
  scope: VoiceFieldScope,
): VoiceSlot | null {
  for (const slot of allSlots(value)) {
    if (slot.domId(value) !== domId) continue;
    // 手で押した欄は、既定で巡回しない任意の欄でも対象にする。
    if (slot.field.optional) return slot;
    if (slot.field.applies && !slot.field.applies(value, scope)) continue;
    return slot;
  }
  return null;
}

/** パッチをフォームへ当てる。行の配列はパッチ側が丸ごと持つ。 */
export function applyVoicePatch(value: EventFormValues, patch: VoicePatch): EventFormValues {
  return { ...value, ...patch };
}

/** いま入っている値を、確認文に使える短い文字列にする。 */
export function describeFieldValue(
  field: VoiceField,
  value: EventFormValues,
  row = 0,
): string | null {
  switch (field.key) {
    case "title":
      return value.title || null;
    case "organizerName":
      return value.organizerDisplayName || null;
    case "scheduleDate":
      return value.schedules[row]?.eventDate || null;
    case "scheduleStart":
      return value.schedules[row]?.startTime || null;
    case "scheduleEnd":
      return value.schedules[row]?.endTime || null;
    case "planName":
      return groupPricePlanPairs(value.pricePlans)[row]?.[0]?.name || null;
    case "planAmount": {
      const amount = value.pricePlans[row]?.amount;
      return amount ? `${amount}円` : null;
    }
    case "planNote":
      return value.pricePlans[row]?.note || null;
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
