import type { DiscountKind, PricingTarget } from "@prisma/client";
import {
  ONE_TIME_PRICE_JPY,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
} from "@/modules/billing/lib/plans";

/**
 * 価格キャンペーンの計算だけを持つ純粋関数。
 * DB も Stripe も触らないので、管理画面のプレビューと決済の両方から同じ結果を引ける。
 */

/** 割引後の最低請求額。100% 引きだけが 0 円になる。 */
export const MIN_CHARGE_JPY = 10;

/** 1回のキャンペーンで割り引ける最大月数。 */
export const MAX_CAMPAIGN_MONTHS = 12;

export type CampaignStatus = "SCHEDULED" | "ACTIVE" | "ENDED" | "STOPPED";

/**
 * 販売する商品。定額プランが 2 段階になったので、月額は 2 つに分かれる。
 * DB の PricingTarget とは別で、こちらは「いくらで売るか」の単位。
 */
export type PricingKind = "ONE_TIME" | "SUBSCRIPTION_8" | "SUBSCRIPTION_UNLIMITED";

/** 定額プランのうち、契約として選べるもの。DB の SubscriptionPlan から NONE を除いた形。 */
export type SubscriptionProduct = "MONTHLY_8" | "UNLIMITED";

export interface CampaignDefinition {
  id: string;
  name: string;
  target: PricingTarget;
  discountKind: DiscountKind;
  percent: number;
  startsAt: Date;
  endsAt: Date;
  priority: number;
  isEnabled: boolean;
  stoppedAt: Date | null;
  version: number;
  freePerUserLimit: number;
  createdAt: Date;
}

export interface PricingQuote {
  target: PricingKind;
  /** 定価（円）。 */
  listPrice: number;
  /** 実際に請求する額（円）。10円単位の切り上げ後。 */
  chargedPrice: number;
  discountAmount: number;
  discountPercent: number;
  discountKind: DiscountKind | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignVersion: number | null;
  campaignEndsAt: string | null;
  /** 0円の単発を1人が受け取れる回数。キャンペーン外は null。 */
  freePerUserLimit: number | null;
}

export function listPriceFor(target: PricingKind): number {
  switch (target) {
    case "ONE_TIME":
      return ONE_TIME_PRICE_JPY;
    case "SUBSCRIPTION_8":
      return SUBSCRIPTION_8_PRICE_JPY;
    case "SUBSCRIPTION_UNLIMITED":
      return SUBSCRIPTION_UNLIMITED_PRICE_JPY;
  }
}

/** 定額プラン（契約）から、販売商品を引く。 */
export function pricingKindOfPlan(plan: SubscriptionProduct): PricingKind {
  return plan === "MONTHLY_8" ? "SUBSCRIPTION_8" : "SUBSCRIPTION_UNLIMITED";
}

/** 販売商品から、定額プラン（契約）を引く。単発なら null。 */
export function planOfPricingKind(kind: PricingKind): SubscriptionProduct | null {
  if (kind === "SUBSCRIPTION_8") return "MONTHLY_8";
  if (kind === "SUBSCRIPTION_UNLIMITED") return "UNLIMITED";
  return null;
}

/**
 * 割引率から請求額を出す。
 * 10円未満は切り上げ、最低 10 円。100% のときだけ 0 円。
 */
export function roundChargedPrice(listPrice: number, percent: number): number {
  if (percent >= 100) return 0;
  if (percent <= 0) return listPrice;
  const raw = (listPrice * (100 - percent)) / 100;
  const rounded = Math.ceil(raw / 10) * 10;
  return Math.min(listPrice, Math.max(MIN_CHARGE_JPY, rounded));
}

/** 丸めた結果、定価より安くなっているか。1円も変わらない割引は登録できない。 */
export function isEffectiveDiscount(listPrice: number, percent: number): boolean {
  return roundChargedPrice(listPrice, percent) < listPrice;
}

export function campaignStatus(campaign: CampaignDefinition, now: Date): CampaignStatus {
  if (campaign.stoppedAt || !campaign.isEnabled) return "STOPPED";
  if (now < campaign.startsAt) return "SCHEDULED";
  if (now >= campaign.endsAt) return "ENDED";
  return "ACTIVE";
}

/**
 * キャンペーンの対象が、この販売商品に効くか。
 * 旧来の SUBSCRIPTION は「定額プランの両方」の意味で残している。
 */
export function campaignAppliesTo(campaign: CampaignDefinition, target: PricingKind): boolean {
  switch (campaign.target) {
    case "BOTH":
      return true;
    case "SUBSCRIPTION":
      return target === "SUBSCRIPTION_8" || target === "SUBSCRIPTION_UNLIMITED";
    case "ONE_TIME":
      return target === "ONE_TIME";
    case "SUBSCRIPTION_8":
      return target === "SUBSCRIPTION_8";
    case "SUBSCRIPTION_UNLIMITED":
      return target === "SUBSCRIPTION_UNLIMITED";
  }
}

/** 有効なキャンペーンのうち、優先度が高く、同じなら新しいものを1つ選ぶ。 */
export function pickCampaign(
  campaigns: readonly CampaignDefinition[],
  target: PricingKind,
  now: Date,
): CampaignDefinition | null {
  const active = campaigns.filter(
    (campaign) => campaignAppliesTo(campaign, target) && campaignStatus(campaign, now) === "ACTIVE",
  );
  active.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const created = b.createdAt.getTime() - a.createdAt.getTime();
    if (created !== 0) return created;
    return b.id.localeCompare(a.id);
  });
  return active[0] ?? null;
}

export function quoteFor(
  target: PricingKind,
  campaigns: readonly CampaignDefinition[],
  now: Date,
): PricingQuote {
  const listPrice = listPriceFor(target);
  const campaign = pickCampaign(campaigns, target, now);
  if (!campaign) {
    return {
      target,
      listPrice,
      chargedPrice: listPrice,
      discountAmount: 0,
      discountPercent: 0,
      discountKind: null,
      campaignId: null,
      campaignName: null,
      campaignVersion: null,
      campaignEndsAt: null,
      freePerUserLimit: null,
    };
  }

  const chargedPrice = roundChargedPrice(listPrice, campaign.percent);
  return {
    target,
    listPrice,
    chargedPrice,
    discountAmount: listPrice - chargedPrice,
    discountPercent: campaign.percent,
    discountKind: campaign.discountKind,
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignVersion: campaign.version,
    campaignEndsAt: campaign.endsAt.toISOString(),
    freePerUserLimit: campaign.freePerUserLimit,
  };
}

export function quoteAll(campaigns: readonly CampaignDefinition[], now: Date): {
  oneTime: PricingQuote;
  subscription8: PricingQuote;
  subscriptionUnlimited: PricingQuote;
} {
  return {
    oneTime: quoteFor("ONE_TIME", campaigns, now),
    subscription8: quoteFor("SUBSCRIPTION_8", campaigns, now),
    subscriptionUnlimited: quoteFor("SUBSCRIPTION_UNLIMITED", campaigns, now),
  };
}

/** 定価が 0 円の商品は作らない。0円販売は割引率 100% で表現する。 */
export function isFreeQuote(quote: PricingQuote): boolean {
  return quote.chargedPrice === 0;
}

function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export { addMonthsUtc };

/**
 * 加入から終了までに何回ぶんの請求を割り引くか。
 * 端数は1か月として切り上げ、キャンペーン終了後の最初の更新まで割引を続ける。
 */
export function discountMonths(start: Date, endsAt: Date): number {
  if (endsAt <= start) return 0;
  const whole =
    (endsAt.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (endsAt.getUTCMonth() - start.getUTCMonth());
  const later = endsAt.getTime() > addMonthsUtc(start, whole).getTime();
  return Math.min(MAX_CAMPAIGN_MONTHS, Math.max(1, whole + (later ? 1 : 0)));
}

/** 割引が終わる日時。Stripe の duration_in_months と同じ数え方にする。 */
export function discountEndsAt(start: Date, endsAt: Date): Date {
  return addMonthsUtc(start, discountMonths(start, endsAt));
}

/** JST の datetime-local 文字列（2026-10-21T10:00）を UTC に直す。 */
export function parseJstDateTime(value: string): Date {
  const trimmed = value.trim();
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}+09:00`;
  return new Date(withZone);
}

export function toJstDateTimeInput(value: Date): string {
  const jst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

/** 管理画面と公開 API に出す形。DB の内部列は出さない。 */
export interface SerializedCampaign {
  id: string;
  name: string;
  target: PricingTarget;
  discountKind: DiscountKind;
  percent: number;
  startsAt: string;
  endsAt: string;
  priority: number;
  isEnabled: boolean;
  status: CampaignStatus;
  freePerUserLimit: number;
  version: number;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeCampaign(
  campaign: CampaignDefinition & { updatedAt: Date },
  now: Date,
): SerializedCampaign {
  return {
    id: campaign.id,
    name: campaign.name,
    target: campaign.target,
    discountKind: campaign.discountKind,
    percent: campaign.percent,
    startsAt: campaign.startsAt.toISOString(),
    endsAt: campaign.endsAt.toISOString(),
    priority: campaign.priority,
    isEnabled: campaign.isEnabled,
    status: campaignStatus(campaign, now),
    freePerUserLimit: campaign.freePerUserLimit,
    version: campaign.version,
    stoppedAt: campaign.stoppedAt ? campaign.stoppedAt.toISOString() : null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}
