import { parseLegacyEventTime, parseLegacyPrice } from "@/lib/serializers";

export type SubscriptionStatus = "NONE" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";
export type RainPolicy = "RAIN_OR_SHINE" | "CANCEL_ON_RAIN" | "POSTPONE_ON_RAIN" | "INDOOR";
export type EventStatus = "DRAFT" | "PUBLISHED" | "CLOSED";
export type EventVisibility = "PUBLIC" | "UNLISTED";
export type RsvpStatus = "ATTENDING" | "DECLINED";
export type OrganizerRole = "OWNER" | "CO_HOST";
/** 費用プランの対象。ANY は男女共通。 */
export type PriceAudience = "ANY" | "MALE" | "FEMALE";
export type Gender = "MALE" | "FEMALE";

/** 開催日時・費用プランの上限。API のバリデーションと画面で共有する。 */
export const MAX_EVENT_OPTIONS = 8;

export interface FlyerAsset {
  id: string;
  imageUrl: string;
  lqipDataUrl: string | null;
  aspectRatio: string;
  title?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  price?: string | null;
  location?: string | null;
  rainPolicy?: RainPolicy | null;
  capacity?: number | null;
}

export interface PricingQuote {
  target: "ONE_TIME" | "SUBSCRIPTION";
  listPrice: number;
  chargedPrice: number;
  discountAmount: number;
  discountPercent: number;
  discountKind: "PERCENT" | "FREE" | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignVersion: number | null;
  campaignEndsAt: string | null;
  freePerUserLimit: number | null;
}

export interface ActiveDiscount {
  percent: number;
  endsAt: string;
  campaignId: string | null;
  campaignName: string | null;
}

export interface UserQuota {
  freeEventCount: number;
  freeLimit: number;
  remainingFree: number;
  paidCredits: number;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  canCreate: boolean;
  planType: "FREE_TRIAL" | "PAID_CREDIT" | "SUBSCRIPTION" | "NONE";
  phoneVerified?: boolean;
  /** いま適用される販売価格。キャンペーンが無ければ定価。 */
  pricing?: {
    oneTime: PricingQuote;
    subscription: PricingQuote;
  };
  /** 0円の単発チケットを、この人があと何回受け取れるか。 */
  freeGrantRemaining?: number;
  /** 適用中の月額割引（無料期間を含む）。 */
  discount?: ActiveDiscount | null;
}

export interface PricingOption {
  type: "SINGLE" | "SUBSCRIPTION";
  name: string;
  price: number;
  listPrice?: number;
  discountPercent?: number;
  campaignName?: string | null;
  currency: string;
  interval?: string;
}

export interface EventScheduleOption {
  id: string;
  eventDate: string;
  /** HH:mm。移行前の既存データは null。 */
  startTime: string | null;
  /** HH:mm。startTime より前なら翌日への日跨ぎ。 */
  endTime: string | null;
  /** 表示用に合成した文字列。既存データでは移行前の自由文のことがある。 */
  eventTime: string;
}

export interface EventPricePlanOption {
  id: string;
  name: string;
  audience: PriceAudience;
  amount: number;
  note: string | null;
  /** 表示用に合成した「3,000円（1ドリンク付）」。 */
  price: string;
}

export interface ScheduleDraft {
  key: string;
  id?: string;
  eventDate: string;
  startTime: string;
  endTime: string;
}

export interface PricePlanDraft {
  key: string;
  id?: string;
  name: string;
  audience: PriceAudience;
  /** 入力途中の空欄を許すため文字列で持つ。送信時に数値へ変える。 */
  amount: string;
  note: string;
}

export interface EventFormValues {
  title: string;
  schedules: ScheduleDraft[];
  pricePlans: PricePlanDraft[];
  /** ゲスト幹事の公開表示名。会員として作るときはサーバーが無視する。 */
  organizerDisplayName: string;
  /** 構造化住所が無いときだけ使う旧・自由入力の開催場所。 */
  location: string;
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
  addressLine: string;
  building: string;
  venueName: string;
  rainPolicy: RainPolicy;
  capacity: number | null;
  flyerAssetId: string | null;
  rsvpDeadline: string;
  status?: EventStatus;
}

export interface PublicEventViewer {
  loggedIn: boolean;
  /** このイベントの幹事（ゲスト幹事の端末 Cookie を含む）。勧誘カードを出さない。 */
  isThisEventsOrganizer: boolean;
  /** 削除されていない主催イベントを1件以上持つ会員。勧誘カードを出さない。 */
  hasOrganizerRole: boolean;
}

/** 公開ページに出す幹事。名前だけを持ち、ID・メールは含めない。 */
export interface PublicOrganizerName {
  name: string;
}

/** 公開ページの「主催 / 共同主催」。 */
export interface PublicEventOrganizers {
  owner: PublicOrganizerName | null;
  coHosts: PublicOrganizerName[];
}

/** 管理画面に出す幹事。メールやユーザーIDは含めない。 */
export interface EventOrganizerSummary {
  id: string;
  role: OrganizerRole;
  /** 解決済みの表示名。会員はアカウント名、ゲストは入力された名前、無ければ役割名。 */
  name: string;
  /** 未登録の幹事（ゲスト）か。 */
  isGuest: boolean;
}

export interface EventOrganizerList {
  /** 筆頭幹事。必ず1名。 */
  owner: EventOrganizerSummary | null;
  /** 共同主催者。作成順。 */
  coHosts: EventOrganizerSummary[];
}

export interface PublicEvent {
  id: string;
  title: string;
  sortDate: string;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  location: string;
  rainPolicy: RainPolicy;
  capacity: number | null;
  status: EventStatus;
  visibility: EventVisibility;
  rsvpDeadline: string | null;
  rsvpOpen: boolean;
  attendingCount: number;
  /** このブラウザが会員としてログインしているか。履歴保存の案内を出し分ける。 */
  loggedIn: boolean;
  viewer: PublicEventViewer;
  /** 筆頭幹事と共同主催者。 */
  organizers: PublicEventOrganizers;
  flyerAsset: FlyerAsset | null;
  myRsvp: MyRsvp | null;
  myReceipt: {
    id: string;
    addressee: string;
    amount: number;
    description: string;
    issuerName: string;
    issuedAt: string;
  } | null;
}

export interface MyRsvp {
  id: string;
  name: string;
  status: RsvpStatus;
  gender: Gender | null;
  comment: string | null;
  scheduleId: string | null;
  pricePlanId: string | null;
}

export interface OrganizerEvent {
  id: string;
  title: string;
  sortDate: string;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  location: string;
  rainPolicy: RainPolicy;
  capacity: number | null;
  status: EventStatus;
  visibility: EventVisibility;
  rsvpDeadline: string | null;
  rsvpOpen: boolean;
  createdAt: string;
  flyerAssetId: string | null;
  role: OrganizerRole;
  /** このイベントの筆頭幹事の表示名。一覧カードで「主催: 名前」に出す。 */
  ownerName: string;
  stats: {
    attendingCount: number;
    declinedCount: number;
    totalResponses: number;
  };
  flyerThumbnailUrl: string | null;
  flyerAsset: FlyerAsset | null;
}

export interface ParticipantRow {
  id: string;
  name: string;
  status: RsvpStatus;
  gender: Gender | null;
  comment: string | null;
  scheduleId: string | null;
  pricePlanId: string | null;
  scheduleLabel: string | null;
  pricePlanLabel: string | null;
  /** 領収書の金額の初期値に使う。プラン未選択なら null。 */
  pricePlanAmount: number | null;
  createdAt: string;
  updatedAt: string;
  receipt: { id: string; issuedAt: string } | null;
}

export interface ReceiptView {
  id: string;
  eventId: string;
  eventTitle: string;
  addressee: string;
  amount: number;
  description: string;
  issuerName: string;
  issuedAt: string;
}

export function createScheduleDraft(partial?: Partial<ScheduleDraft>): ScheduleDraft {
  return {
    key: partial?.key ?? crypto.randomUUID(),
    id: partial?.id,
    eventDate: partial?.eventDate ?? "",
    startTime: partial?.startTime ?? "",
    endTime: partial?.endTime ?? "",
  };
}

export function createPricePlanDraft(partial?: Partial<PricePlanDraft>): PricePlanDraft {
  return {
    key: partial?.key ?? crypto.randomUUID(),
    id: partial?.id,
    name: partial?.name ?? "",
    audience: partial?.audience ?? "ANY",
    amount: partial?.amount ?? "",
    note: partial?.note ?? "",
  };
}

/**
 * 費用の入力モード。既定は共通（ANY）で、必要なときだけ男女別にする。
 * DB には保存せず、プラン行の audience から導出する。
 */
export type PricingMode = "COMMON" | "GENDER";

/** 1件でも男性用・女性用があれば男女別モード。 */
export function pricingModeOf(plans: { audience: PriceAudience }[]): PricingMode {
  return plans.some((row) => row.audience !== "ANY") ? "GENDER" : "COMMON";
}

/**
 * 男女別モードの行を、追加した順のペアへまとめる。
 * 「プランを追加」は常に男性用・女性用の順で足すため、隣り合う男性用と女性用を1組とみなす。
 * 相手が見つからない行（移行前のデータや、片方だけ残った行）は1行だけの組になる。
 * DB には保存しない、画面の削除単位を決めるためだけの関数である。
 */
export function groupPricePlanPairs<T extends { key: string; audience: PriceAudience }>(
  plans: T[],
): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const row = plans[index];
    const next = plans[index + 1];
    if (row.audience === "MALE" && next?.audience === "FEMALE") {
      groups.push([row, next]);
      index += 1;
      continue;
    }
    groups.push([row]);
  }
  return groups;
}

/**
 * 組の全行へ同じプラン名を入れる。
 * 男女別は1組＝1プランなので、画面の入力欄は組ごとに1つだけ出す。
 * 行は増やさず名前だけを書き換えるため、(event_id, audience, name) の一意制約には当たらない。
 */
export function withGroupName<T extends { key: string; name: string }>(
  plans: T[],
  group: readonly T[],
  name: string,
): T[] {
  const keys = new Set(group.map((row) => row.key));
  return plans.map((row) => (keys.has(row.key) ? { ...row, name } : row));
}

/**
 * 1組の中でプラン名が食い違っているか。
 * 切り替え直後は揃うが、移行前のデータや、以前の画面で片方だけ直した組ではずれる。
 */
export function groupNamesDiffer(group: readonly { name: string }[]): boolean {
  return group.length > 1 && group.some((row) => row.name !== group[0].name);
}

/**
 * 共通プランを男性用・女性用のペアへ展開する。
 * 元の行は id を保ったまま男性用にし、女性用は新しい行として足す
 * （(event_id, audience, name) の一意制約があるので同名で並べられる）。
 * 上限は2件を1組として数え、組の途中で切らない。
 */
export function withGenderPricing(plans: PricePlanDraft[]): PricePlanDraft[] {
  const expanded: PricePlanDraft[] = [];
  const seen = new Set<string>();
  for (const group of groupPricePlanPairs(plans)) {
    const pair: PricePlanDraft[] = group.flatMap((row) =>
      row.audience !== "ANY"
        ? [row]
        : [
            { ...row, key: `${row.key}::male`, audience: "MALE" as const },
            { ...row, key: `${row.key}::female`, id: undefined, audience: "FEMALE" as const },
          ],
    );
    if (expanded.length + pair.length > MAX_EVENT_OPTIONS) continue;
    // 同じ対象・同じプラン名は DB の一意制約に当たるため、組ごと落とす。
    const conflicts = pair.some((item) => {
      const name = item.name.trim();
      return name !== "" && seen.has(`${item.audience}\u0000${name}`);
    });
    if (conflicts) continue;
    for (const item of pair) {
      const name = item.name.trim();
      if (name !== "") seen.add(`${item.audience}\u0000${name}`);
      expanded.push(item);
    }
  }
  return expanded.length > 0 ? expanded : [createPricePlanDraft()];
}

/**
 * 男女別を共通へ戻す。男性用の行を ANY に変換し、女性用の行は落とす。
 * ANY に寄せた結果プラン名が重複すると API と DB の一意制約に当たるため、先に現れた行を残す。
 * 女性用を選んでいた参加者の pricePlanId はサーバー側で NULL になるため、
 * 呼び出し側で確認ダイアログを出す。
 */
export function withCommonPricing(plans: PricePlanDraft[]): PricePlanDraft[] {
  const seen = new Set<string>();
  const kept: PricePlanDraft[] = [];
  for (const row of plans) {
    if (row.audience === "FEMALE") continue;
    const name = row.name.trim();
    if (name !== "" && seen.has(name)) continue;
    if (name !== "") seen.add(name);
    kept.push({ ...row, audience: "ANY" as const });
  }
  return kept.length > 0 ? kept : [createPricePlanDraft()];
}

/** 移行前の自由文から開始・終了を取り出す。解析できなければ空欄にして入力を促す。 */
function draftTimeRange(row: EventScheduleOption): { startTime: string; endTime: string } {
  if (row.startTime && row.endTime) {
    return { startTime: row.startTime, endTime: row.endTime };
  }
  const parsed = parseLegacyEventTime(row.eventTime);
  return { startTime: parsed?.startTime ?? "", endTime: parsed?.endTime ?? "" };
}

export function draftsFromOptions(event: {
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
}): Pick<EventFormValues, "schedules" | "pricePlans"> {
  return {
    schedules:
      event.schedules.length > 0
        ? event.schedules.map((row) =>
            createScheduleDraft({
              key: row.id,
              id: row.id,
              eventDate: row.eventDate,
              ...draftTimeRange(row),
            }),
          )
        : [createScheduleDraft()],
    pricePlans:
      event.pricePlans.length > 0
        ? event.pricePlans.map((row) =>
            createPricePlanDraft({
              key: row.id,
              id: row.id,
              name: row.name,
              audience: row.audience,
              amount: String(row.amount),
              note: row.note ?? "",
            }),
          )
        : [createPricePlanDraft()],
  };
}

export function toEventRequest(form: EventFormValues, referrerEventId?: string | null) {
  const structured = Boolean(
    form.prefecture || form.city || form.town || form.addressLine || form.building,
  );
  return {
    title: form.title,
    ...(form.organizerDisplayName.trim()
      ? { organizerDisplayName: form.organizerDisplayName.trim() }
      : {}),
    schedules: form.schedules.map(({ id, eventDate, startTime, endTime }) => ({
      ...(id ? { id } : {}),
      eventDate,
      startTime,
      endTime,
    })),
    pricePlans: form.pricePlans.map(({ id, name, audience, amount, note }) => ({
      ...(id ? { id } : {}),
      name,
      audience,
      amount: Number(amount || 0),
      note: note.trim() || null,
    })),
    // 構造化住所があるときはサーバーが組み立てる。無いときだけ旧・自由入力を送る。
    ...(structured
      ? {
          postalCode: form.postalCode || null,
          prefecture: form.prefecture || null,
          city: form.city || null,
          town: form.town || null,
          addressLine: form.addressLine || null,
          building: form.building || null,
          venueName: form.venueName || null,
        }
      : { location: form.location, venueName: form.venueName || null }),
    rainPolicy: form.rainPolicy,
    capacity: form.capacity,
    flyerAssetId: form.flyerAssetId,
    rsvpDeadline: form.rsvpDeadline ? form.rsvpDeadline : null,
    ...(referrerEventId ? { referrerEventId } : {}),
    ...(form.status ? { status: form.status } : {}),
  };
}

export function applyFlyerToForm(
  current: EventFormValues,
  flyer: {
    id: string;
    imageUrl?: string;
    title?: string | null;
    eventDate?: string | null;
    eventTime?: string | null;
    price?: string | null;
    location?: string | null;
    rainPolicy?: RainPolicy | null;
    capacity?: number | null;
  },
): EventFormValues {
  const structured = Boolean(
    current.prefecture || current.city || current.town || current.addressLine || current.building,
  );
  const timeRange = flyer.eventTime ? parseLegacyEventTime(flyer.eventTime) : null;
  const legacyPrice = flyer.price ? parseLegacyPrice(flyer.price) : null;
  return {
    ...current,
    flyerAssetId: flyer.id,
    title: flyer.title || current.title,
    // 構造化住所を入力済みなら消さない。チラシの場所は自由文なので従来欄にだけ入れる。
    location: !structured && flyer.location ? flyer.location : current.location,
    rainPolicy: flyer.rainPolicy ?? current.rainPolicy,
    capacity: flyer.capacity ?? current.capacity,
    schedules: current.schedules.map((row, index) =>
      index === 0
        ? {
            ...row,
            eventDate: flyer.eventDate || row.eventDate,
            startTime: timeRange?.startTime ?? row.startTime,
            endTime: timeRange?.endTime ?? row.endTime,
          }
        : row,
    ),
    pricePlans: current.pricePlans.map((row, index) => {
      if (index !== 0) return row;
      const amount = legacyPrice ? String(legacyPrice.amount) : row.amount;
      const note = legacyPrice?.note ?? row.note;
      return {
        ...row,
        amount,
        note,
        name: row.name.trim() ? row.name : flyer.price ? "標準" : row.name,
      };
    }),
  };
}

export const FLYER_TEMPLATE_IDS = [
  "style_1_bar_stylish",
  "style_2_warm_earth",
  "style_3_vibrant_pop",
] as const;

export type FlyerTemplateId = (typeof FLYER_TEMPLATE_IDS)[number];

export const FLYER_TEMPLATE_LABELS: Record<FlyerTemplateId, string> = {
  style_1_bar_stylish: "バー・スタイリッシュ",
  style_2_warm_earth: "あたたかいアース",
  style_3_vibrant_pop: "ビビッド・ポップ",
};

/** 文字ブロックの配置プリセット。順序はウィザードの表示順。 */
export const FLYER_LAYOUT_IDS = [
  "classic",
  "top_stack",
  "center_stack",
  "bottom_stack",
] as const;

export type FlyerLayoutId = (typeof FLYER_LAYOUT_IDS)[number];

export const FLYER_LAYOUT_LABELS: Record<FlyerLayoutId, string> = {
  classic: "標準",
  top_stack: "上にまとめる",
  center_stack: "中央にまとめる",
  bottom_stack: "下にまとめる",
};

export const FLYER_LAYOUT_DESCRIPTIONS: Record<FlyerLayoutId, string> = {
  classic: "上から順に詰める。どんな写真でも合わせやすい",
  top_stack: "文字を上へ。下半分が空くので下に被写体を置ける",
  center_stack: "中央にまとめる。上下に余白が残る",
  bottom_stack: "文字を下へ。上半分が空くので上に被写体を置ける",
};

export const RAIN_POLICY_LABELS: Record<RainPolicy, string> = {
  RAIN_OR_SHINE: "雨天決行",
  CANCEL_ON_RAIN: "雨天中止",
  POSTPONE_ON_RAIN: "雨天順延",
  INDOOR: "屋内開催",
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: "下書き",
  PUBLISHED: "公開中",
  CLOSED: "受付停止",
};

/**
 * 将来のメディアサイト向けの表示名。いまのアプリは一覧を持たないため画面には出さない。
 * 値は API の読み取り契約（`Event.visibility`）として残している。
 */
export const VISIBILITY_LABELS: Record<EventVisibility, string> = {
  PUBLIC: "一覧掲載",
  UNLISTED: "紹介制",
};

export { GENDER_LABELS, PRICE_AUDIENCE_LABELS } from "@/lib/serializers";

export const EMPTY_EVENT_FORM: EventFormValues = {
  title: "",
  organizerDisplayName: "",
  schedules: [createScheduleDraft({ key: "schedule-initial" })],
  pricePlans: [createPricePlanDraft({ key: "plan-initial" })],
  location: "",
  postalCode: "",
  prefecture: "",
  city: "",
  town: "",
  addressLine: "",
  building: "",
  venueName: "",
  rainPolicy: "RAIN_OR_SHINE",
  capacity: null,
  flyerAssetId: null,
  rsvpDeadline: "",
  status: "PUBLISHED",
};
