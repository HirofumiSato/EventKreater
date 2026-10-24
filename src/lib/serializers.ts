import type {
  EventStatus,
  EventVisibility,
  Gender,
  OrganizerRole,
  PriceAudience,
  RainPolicy,
  RsvpStatus,
} from "@prisma/client";
import { isGuestOrganizer, organizerLabel } from "@/modules/organizers/lib/names";

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PRICE_AUDIENCE_LABELS: Record<PriceAudience, string> = {
  ANY: "共通",
  MALE: "男性",
  FEMALE: "女性",
};

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: "男性",
  FEMALE: "女性",
};

/** 参加者の性別から選べる費用プランの対象を返す。 */
export function audiencesForGender(gender: Gender): PriceAudience[] {
  return gender === "MALE" ? ["MALE", "ANY"] : ["FEMALE", "ANY"];
}

/** 0 円は「無料」と表示する。 */
export function formatYen(amount: number): string {
  if (amount === 0) return "無料";
  return `${amount.toLocaleString("ja-JP")}円`;
}

/** 金額と補足から表示文を合成する。例: 3,000円（1ドリンク付） */
export function composePriceText(plan: { amount: number; note?: string | null }): string {
  const base = formatYen(plan.amount);
  const note = plan.note?.trim();
  return note ? `${base}（${note}）` : base;
}

/** 開始・終了から表示用の文字列を作る。終了が開始より前なら翌日扱い。 */
export function composeEventTime(
  startTime?: string | null,
  endTime?: string | null,
  fallback?: string | null,
): string {
  if (!startTime || !endTime) return fallback ?? "";
  if (endTime < startTime) return `${startTime}〜翌${endTime}`;
  return `${startTime}〜${endTime}`;
}

/** 構造化住所から表示用の開催場所を合成する。空なら fallback をそのまま返す。 */
export function composeLocation(input: {
  venueName?: string | null;
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;
  addressLine?: string | null;
  building?: string | null;
  /** 構造化住所が無いときに使う、従来の自由入力の開催場所。 */
  location?: string | null;
  fallback?: string | null;
}): string {
  const address = [input.prefecture, input.city, input.town, input.addressLine]
    .map((part) => part?.trim() ?? "")
    .join("");
  const structured = [input.venueName?.trim(), address, input.building?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return structured || input.location?.trim() || input.fallback?.trim() || "";
}

/** 旧・費用文から金額と補足を取り出す。移行スクリプトとテストで共有する。 */
export function parseLegacyPrice(source: string): { amount: number; note: string | null } {
  const text = source.trim();
  const matched = /([0-9][0-9,]*)\s*円/.exec(text);
  const amount = matched ? Number(matched[1].replace(/,/g, "")) : 0;
  const parenthesized = /[（(]([^）)]*)[）)]/.exec(text);
  const note = parenthesized?.[1]?.trim() || null;
  return { amount: Number.isFinite(amount) ? amount : 0, note };
}

/** 旧・開催時間から開始・終了を取り出す。解析できなければ null。 */
export function parseLegacyEventTime(source: string): { startTime: string; endTime: string } | null {
  const normalized = source
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[〜~～ー–—−]/g, "-")
    .replace(/翌日?/g, "")
    .replace(/\s/g, "");
  const matched = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(normalized);
  if (!matched) return null;
  const pad = (value: string) => value.padStart(5, "0");
  const startTime = pad(matched[1]);
  const endTime = pad(matched[2]);
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) return null;
  if (startTime === endTime) return null;
  return { startTime, endTime };
}

export interface FlyerShape {
  id: string;
  imageUrl: string;
  lqipDataUrl: string | null;
  aspectRatio: string;
  title?: string | null;
  eventDate?: Date | null;
  eventTime?: string | null;
  price?: string | null;
  location?: string | null;
  rainPolicy?: RainPolicy | null;
  capacity?: number | null;
}

export function formatEventDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseEventDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * 画面とメールに出す日付。`2026-11-08` → `11月8日（日）`。
 * 保存形式（`formatEventDate`）は API と DB の都合で変えない。
 */
export function formatEventDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEADLINE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function formatRsvpDeadlineInput(value: Date): string {
  const shifted = new Date(value.getTime() + TOKYO_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function parseRsvpDeadline(value: string): Date | null {
  const match = DEADLINE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
  if (Number.isNaN(utc.getTime())) return null;
  if (formatRsvpDeadlineInput(utc) !== value) return null;
  return utc;
}

export function formatRsvpDeadlineLabel(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function isRsvpAccepting(
  event: { status: string; rsvpDeadline: Date | null },
  now = new Date(),
): boolean {
  if (event.status !== "PUBLISHED") return false;
  if (!event.rsvpDeadline) return true;
  return now.getTime() < event.rsvpDeadline.getTime();
}

export function serializeFlyer(
  flyer: FlyerShape | null | undefined,
): {
  id: string;
  imageUrl: string;
  lqipDataUrl: string | null;
  aspectRatio: string;
  title: string | null;
  eventDate: string | null;
  eventTime: string | null;
  price: string | null;
  location: string | null;
  rainPolicy: RainPolicy | null;
  capacity: number | null;
} | null {
  if (!flyer) return null;
  return {
    id: flyer.id,
    imageUrl: flyer.imageUrl,
    lqipDataUrl: flyer.lqipDataUrl,
    aspectRatio: flyer.aspectRatio,
    title: flyer.title ?? null,
    eventDate: flyer.eventDate ? formatEventDate(flyer.eventDate) : null,
    eventTime: flyer.eventTime ?? null,
    price: flyer.price ?? null,
    location: flyer.location ?? null,
    rainPolicy: flyer.rainPolicy ?? null,
    capacity: flyer.capacity ?? null,
  };
}

export interface ScheduleRecord {
  id: string;
  eventDate: Date;
  eventTime: string;
  startTime?: string | null;
  endTime?: string | null;
  sortOrder: number;
}

export interface PricePlanRecord {
  id: string;
  name: string;
  audience: PriceAudience;
  amount: number;
  note: string | null;
  sortOrder: number;
}

export interface EventRecordShape {
  id: string;
  title: string;
  sortDate: Date;
  location: string;
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;
  addressLine?: string | null;
  building?: string | null;
  venueName?: string | null;
  rainPolicy: RainPolicy;
  capacity: number | null;
  status: EventStatus;
  visibility: EventVisibility;
  rsvpDeadline: Date | null;
  createdAt: Date;
  flyerAssetId: string | null;
  flyerAsset?: FlyerShape | null;
  schedules: ScheduleRecord[];
  pricePlans: PricePlanRecord[];
}

export function serializeSchedules(rows: ScheduleRecord[]) {
  return [...rows]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((row) => ({
      id: row.id,
      eventDate: formatEventDate(row.eventDate),
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
      eventTime: composeEventTime(row.startTime, row.endTime, row.eventTime),
    }));
}

export function serializePricePlans(rows: PricePlanRecord[]) {
  return [...rows]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((row) => ({
      id: row.id,
      name: row.name,
      audience: row.audience,
      amount: row.amount,
      note: row.note,
      price: composePriceText(row),
    }));
}

export function scheduleLabel(rows: { eventDate: string; eventTime: string }[]): string {
  if (rows.length === 0) return "";
  const first = `${formatEventDateLabel(rows[0].eventDate)} ${rows[0].eventTime}`.trim();
  if (rows.length === 1) return first;
  return `${first} ほか${rows.length - 1}件`;
}

/** 一覧・メール用。対象と金額を含め、長いときは先頭だけにする。 */
export function priceLabel(
  rows: { name: string; price: string; audience?: PriceAudience }[],
): string {
  if (rows.length === 0) return "";
  const single = (row: (typeof rows)[number]) => {
    const prefix = row.audience && row.audience !== "ANY" ? `${PRICE_AUDIENCE_LABELS[row.audience]} ` : "";
    return `${prefix}${row.name} ${row.price}`.trim();
  };
  if (rows.length === 1) return single(rows[0]);
  const joined = rows.map(single).join(" / ");
  if (joined.length <= 80) return joined;
  return `${single(rows[0])} ほか${rows.length - 1}件`;
}

/**
 * 参加者の選択内容を 1 行で表す。名簿・CSV・履歴で共通に使う。
 * 金額は amount から作り、無ければ移行前の price 文字列を使う。
 */
export function pricePlanChoiceLabel(plan: {
  name: string;
  price?: string | null;
  audience?: PriceAudience;
  amount?: number;
  note?: string | null;
}): string {
  const prefix = plan.audience && plan.audience !== "ANY" ? `${PRICE_AUDIENCE_LABELS[plan.audience]} ` : "";
  const price =
    plan.amount !== undefined
      ? composePriceText({ amount: plan.amount, note: plan.note })
      : (plan.price ?? "");
  return `${prefix}${plan.name} ${price}`.trim();
}

/**
 * 名簿に出す、その人が申し込んだ費用プラン。
 * 出欠確定時点の金額が残っていればそちらを優先する。費用プランを編集しても、
 * 名簿の金額が売上と食い違わないようにするため。
 */
export function participantPriceDisplay(row: {
  priceAmount: number | null;
  pricePlanName: string | null;
  priceAudience: PriceAudience | null;
  pricePlan?: { name: string; price?: string | null; audience?: PriceAudience; amount?: number; note?: string | null } | null;
}): { label: string | null; amount: number | null } {
  if (row.priceAmount !== null) {
    return {
      label: pricePlanChoiceLabel({
        name: row.pricePlanName ?? "プラン名なし",
        audience: row.priceAudience ?? "ANY",
        amount: row.priceAmount,
      }),
      amount: row.priceAmount,
    };
  }
  return {
    label: row.pricePlan ? pricePlanChoiceLabel(row.pricePlan) : null,
    amount: row.pricePlan?.amount ?? null,
  };
}

/** チラシの費用を 30 文字までに収める。入りきらないときは先頭の金額に「〜」を付ける。 */
export function flyerPriceLabel(
  rows: { name: string; audience?: PriceAudience; amount: number; note?: string | null }[],
): string {
  if (rows.length === 0) return "";
  const short = (row: (typeof rows)[number]) => {
    const prefix = row.audience && row.audience !== "ANY" ? `${PRICE_AUDIENCE_LABELS[row.audience]}` : "";
    return `${prefix}${formatYen(row.amount)}`;
  };
  if (rows.length === 1) {
    return composePriceText(rows[0]).slice(0, 30);
  }
  const joined = rows.map(short).join(" / ");
  if (joined.length <= 30) return joined;
  return `${short(rows[0]).slice(0, 29)}〜`;
}

/** チラシは 60 文字まで。会場名と市区町村に絞る。 */
export function flyerLocationLabel(event: {
  venueName?: string | null;
  city?: string | null;
  location: string;
}): string {
  const short = [event.venueName?.trim(), event.city?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  const value = short || event.location;
  return value.slice(0, 60);
}

export function serializeEvent(event: EventRecordShape) {
  const schedules = serializeSchedules(event.schedules);
  const pricePlans = serializePricePlans(event.pricePlans);
  return {
    id: event.id,
    title: event.title,
    sortDate: formatEventDate(event.sortDate),
    schedules,
    pricePlans,
    location: event.location,
    postalCode: event.postalCode ?? null,
    prefecture: event.prefecture ?? null,
    city: event.city ?? null,
    town: event.town ?? null,
    addressLine: event.addressLine ?? null,
    building: event.building ?? null,
    venueName: event.venueName ?? null,
    rainPolicy: event.rainPolicy,
    capacity: event.capacity,
    status: event.status,
    visibility: event.visibility,
    rsvpDeadline: event.rsvpDeadline ? event.rsvpDeadline.toISOString() : null,
    rsvpOpen: isRsvpAccepting(event),
    createdAt: event.createdAt.toISOString(),
    flyerAssetId: event.flyerAssetId,
    flyerAsset: serializeFlyer(event.flyerAsset),
  };
}

export interface ParticipantStats {
  attendingCount: number;
  declinedCount: number;
  waitlistedCount: number;
  totalResponses: number;
}

export function emptyStats(): ParticipantStats {
  return { attendingCount: 0, declinedCount: 0, waitlistedCount: 0, totalResponses: 0 };
}

export function summarizeStatuses(statuses: RsvpStatus[]): ParticipantStats {
  let attendingCount = 0;
  let declinedCount = 0;
  let waitlistedCount = 0;
  for (const status of statuses) {
    if (status === "ATTENDING") attendingCount += 1;
    if (status === "DECLINED") declinedCount += 1;
    if (status === "WAITLISTED") waitlistedCount += 1;
  }
  return {
    attendingCount,
    declinedCount,
    waitlistedCount,
    totalResponses: attendingCount + declinedCount + waitlistedCount,
  };
}

export function serializeOrganizerListItem(
  event: EventRecordShape,
  role: OrganizerRole,
  stats: ParticipantStats,
  ownerName: string,
  ownerUserId: string | null = null,
) {
  return {
    ...serializeEvent(event),
    role,
    ownerName,
    ownerUserId,
    stats,
    flyerThumbnailUrl: event.flyerAsset?.imageUrl ?? null,
  };
}

export interface OrganizerSummarySource {
  id: string;
  role: OrganizerRole;
  userId?: string | null;
  displayName?: string | null;
  user?: { name?: string | null } | null;
}

/** 公開ページ用。メールやユーザーIDは出さず、表示名だけを返す。 */
export function serializeOrganizerSummary(row: OrganizerSummarySource) {
  return {
    id: row.id,
    role: row.role,
    name: organizerLabel(row),
    isGuest: isGuestOrganizer(row),
    /**
     * 公開プロフィールの URL に使う。プレビュー（/organizer/events/[id]/preview）が
     * 告知ページと同じ主催者リンクを出すために持つ。ゲスト幹事は null。
     */
    userId: row.userId ?? null,
  };
}

/** 幹事行を「筆頭幹事1名 + 共同主催者」に分ける。作成順を保つ。 */
export function serializeOrganizerList(rows: OrganizerSummarySource[]) {
  const sorted = [...rows].sort((left, right) => {
    if (left.role !== right.role) return left.role === "OWNER" ? -1 : 1;
    return 0;
  });
  const owner = sorted.find((row) => row.role === "OWNER") ?? null;
  const coHosts = sorted.filter((row) => row.role === "CO_HOST");
  return {
    owner: owner ? serializeOrganizerSummary(owner) : null,
    coHosts: coHosts.map(serializeOrganizerSummary),
  };
}

/**
 * 公開告知ページ用。名前と、公開ページの URL に使う会員 ID だけを返す。
 * 主催者行の ID・メールは出さない。ゲスト幹事は `userId: null` で、公開ページを持たない。
 * 並びは作成順。
 */
export function serializePublicOrganizerList(rows: OrganizerSummarySource[]) {
  const sorted = [...rows].sort((left, right) => {
    if (left.role !== right.role) return left.role === "OWNER" ? -1 : 1;
    return 0;
  });
  const toPublic = (row: OrganizerSummarySource) => ({
    name: organizerLabel(row),
    userId: row.userId ?? null,
  });
  const owner = sorted.find((row) => row.role === "OWNER");
  return {
    owner: owner ? toPublic(owner) : null,
    coHosts: sorted.filter((row) => row.role === "CO_HOST").map(toPublic),
  };
}
