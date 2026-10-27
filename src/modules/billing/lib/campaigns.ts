import type { Prisma, PricingCampaign, PricingTarget } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { getStripe } from "@/modules/billing/lib/stripe";
import {
  MAX_CAMPAIGN_MONTHS,
  addMonthsUtc,
  isEffectiveDiscount,
  listPriceFor,
  parseJstDateTime,
  pricingKindOfPlan,
  roundChargedPrice,
  type CampaignDefinition,
  type PricingKind,
  type SubscriptionProduct,
} from "@/modules/billing/lib/pricing";

/** 割引の検証で出す商品名。 */
const PRICING_KIND_LABEL: Record<PricingKind, string> = {
  ONE_TIME: "単発",
  SUBSCRIPTION_8: "月8回プラン",
  SUBSCRIPTION_UNLIMITED: "作り放題",
};

export interface CampaignInput {
  name: string;
  target: PricingTarget;
  discountKind: "PERCENT" | "FREE";
  percent: number;
  startsAt: string;
  endsAt: string;
  priority?: number;
  isEnabled?: boolean;
  freePerUserLimit?: number;
}

export interface NormalizedCampaign {
  name: string;
  target: PricingTarget;
  discountKind: "PERCENT" | "FREE";
  percent: number;
  startsAt: Date;
  endsAt: Date;
  priority: number;
  isEnabled: boolean;
  freePerUserLimit: number;
}

function invalid(detail: string, error = "INVALID_PRICING_CAMPAIGN"): ProblemDetailException {
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    type: "probs/validation-error",
    detail,
    error,
  });
}

/**
 * 画面の入力を検証して、保存できる形に直す。
 * 1円も安くならない割引は、購入者に何も起きないので登録させない。
 */
export function normalizeCampaignInput(input: CampaignInput): NormalizedCampaign {
  const startsAt = parseJstDateTime(input.startsAt);
  const endsAt = parseJstDateTime(input.endsAt);
  if (Number.isNaN(startsAt.getTime())) throw invalid("開始日時の形式が不正です。");
  if (Number.isNaN(endsAt.getTime())) throw invalid("終了日時の形式が不正です。");
  if (endsAt <= startsAt) throw invalid("終了日時は開始日時より後にしてください。");
  if (endsAt > addMonthsUtc(startsAt, MAX_CAMPAIGN_MONTHS)) {
    throw invalid(`キャンペーンは最大${MAX_CAMPAIGN_MONTHS}か月までです。`);
  }

  const isFree = input.discountKind === "FREE";
  const percent = isFree ? 100 : input.percent;
  if (!Number.isInteger(percent) || percent < 1 || percent > (isFree ? 100 : 99)) {
    throw invalid("割引率は1〜99%で指定してください。0円は「無料」を選びます。");
  }

  const targets: PricingKind[] =
    input.target === "BOTH"
      ? ["ONE_TIME", "SUBSCRIPTION_8", "SUBSCRIPTION_UNLIMITED"]
      : input.target === "SUBSCRIPTION"
        ? ["SUBSCRIPTION_8", "SUBSCRIPTION_UNLIMITED"]
        : [input.target];
  for (const target of targets) {
    if (!isEffectiveDiscount(listPriceFor(target), percent)) {
      throw invalid(
        `${PRICING_KIND_LABEL[target]}の割引額が10円未満のため、値引きになりません。割引率を上げてください。`,
      );
    }
  }

  return {
    name: input.name.trim(),
    target: input.target,
    discountKind: input.discountKind,
    percent,
    startsAt,
    endsAt,
    priority: input.priority ?? 0,
    isEnabled: input.isEnabled ?? true,
    freePerUserLimit: input.freePerUserLimit ?? 1,
  };
}

function toDefinition(campaign: PricingCampaign): CampaignDefinition {
  return {
    id: campaign.id,
    name: campaign.name,
    target: campaign.target,
    discountKind: campaign.discountKind,
    percent: campaign.percent,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    priority: campaign.priority,
    isEnabled: campaign.isEnabled,
    stoppedAt: campaign.stoppedAt,
    version: campaign.version,
    freePerUserLimit: campaign.freePerUserLimit,
    createdAt: campaign.createdAt,
  };
}

/** 決済と表示に使う、いま有効なキャンペーンだけ。 */
export async function loadActiveCampaigns(now = new Date()): Promise<CampaignDefinition[]> {
  const rows = await prisma.pricingCampaign.findMany({
    where: {
      isEnabled: true,
      stoppedAt: null,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toDefinition);
}

export async function listCampaigns(): Promise<PricingCampaign[]> {
  return prisma.pricingCampaign.findMany({
    orderBy: [{ createdAt: "desc" }],
  });
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    actorUserId: string;
    action: "CREATE" | "UPDATE" | "STOP";
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.pricingCampaignAudit.create({
    data: {
      campaignId: input.campaignId,
      actorUserId: input.actorUserId,
      action: input.action,
      before: input.before,
      after: input.after,
    },
  });
}

/** JSON 列には Date をそのまま入れられないので ISO 文字列に直す。 */
function snapshot(
  input: NormalizedCampaign,
): Prisma.InputJsonObject {
  return {
    name: input.name,
    target: input.target,
    discountKind: input.discountKind,
    percent: input.percent,
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    priority: input.priority,
    isEnabled: input.isEnabled,
    freePerUserLimit: input.freePerUserLimit,
  };
}

function definitionSnapshot(campaign: PricingCampaign): Prisma.InputJsonObject {
  return snapshot({
    name: campaign.name,
    target: campaign.target,
    discountKind: campaign.discountKind,
    percent: campaign.percent,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    priority: campaign.priority,
    isEnabled: campaign.isEnabled,
    freePerUserLimit: campaign.freePerUserLimit,
  });
}


export async function createCampaign(
  input: CampaignInput,
  actorUserId: string,
): Promise<PricingCampaign> {
  const normalized = normalizeCampaignInput(input);
  return prisma.$transaction(async (tx) => {
    const created = await tx.pricingCampaign.create({
      data: {
        ...normalized,
        createdByUserId: actorUserId,
      },
    });
    await writeAudit(tx, {
      campaignId: created.id,
      actorUserId,
      action: "CREATE",
      after: snapshot(normalized),
    });
    return created;
  });
}

/** 既存の購入者へは触らない。新しい版のクーポンを次の申込から使う。 */
export async function updateCampaign(
  id: string,
  input: CampaignInput,
  actorUserId: string,
): Promise<PricingCampaign> {
  const normalized = normalizeCampaignInput(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.pricingCampaign.findUnique({ where: { id } });
    if (!before) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "キャンペーンが見つかりません。",
      });
    }
    if (before.stoppedAt) {
      throw invalid("停止済みのキャンペーンは編集できません。新しいキャンペーンを作成してください。");
    }

    const affectsCoupon =
      before.target !== normalized.target ||
      before.discountKind !== normalized.discountKind ||
      before.percent !== normalized.percent ||
      before.startsAt.getTime() !== normalized.startsAt.getTime() ||
      before.endsAt.getTime() !== normalized.endsAt.getTime();

    const updated = await tx.pricingCampaign.update({
      where: { id },
      data: {
        ...normalized,
        ...(affectsCoupon ? { version: { increment: 1 } } : {}),
      },
    });
    await writeAudit(tx, {
      campaignId: id,
      actorUserId,
      action: "UPDATE",
      before: definitionSnapshot(before),
      after: snapshot(normalized),
    });
    return updated;
  });
}

/**
 * 新規申込だけ止める。すでにクーポンを持っている購入者は、
 * Stripe 側の duration_in_months が切れるまで割引が続く。
 */
export async function stopCampaign(id: string, actorUserId: string): Promise<PricingCampaign> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.pricingCampaign.findUnique({ where: { id } });
    if (!before) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "キャンペーンが見つかりません。",
      });
    }
    if (before.stoppedAt) return before;

    const stopped = await tx.pricingCampaign.update({
      where: { id },
      data: { isEnabled: false, stoppedAt: new Date() },
    });
    await writeAudit(tx, {
      campaignId: id,
      actorUserId,
      action: "STOP",
      before: definitionSnapshot(before),
      after: { isEnabled: false, stoppedAt: stopped.stoppedAt?.toISOString() ?? null },
    });
    return stopped;
  });
}

function couponName(campaign: PricingCampaign, months: number): string {
  const base = campaign.discountKind === "FREE" ? "0円" : `${campaign.percent}%OFF`;
  return `${base} ${campaign.name}`.slice(0, 40) || `${months}か月割引`;
}

/**
 * 月額の割引クーポン。同じキャンペーン版・同じ月数・同じプランなら使い回す。
 * 既存購入者のクーポンは Stripe 側に残るので、版を上げても止まらない。
 */
export async function ensureCampaignCoupon(
  campaign: PricingCampaign,
  months: number,
  plan: SubscriptionProduct,
): Promise<string> {
  const kind = campaign.discountKind;
  const existing = await prisma.pricingCampaignCoupon.findUnique({
    where: {
      campaignId_version_months_kind_plan: {
        campaignId: campaign.id,
        version: campaign.version,
        months,
        kind,
        plan,
      },
    },
  });
  if (existing) return existing.stripeCouponId;

  const listPrice = listPriceFor(pricingKindOfPlan(plan));
  const charged = roundChargedPrice(listPrice, campaign.percent);
  const common = {
    duration: "repeating" as const,
    duration_in_months: months,
    name: couponName(campaign, months),
    metadata: {
      campaignId: campaign.id,
      campaignVersion: String(campaign.version),
      months: String(months),
      plan,
    },
  };
  // currency は amount_off のときだけ指定する。percent_off と併用すると Stripe が拒否する。
  const params: Stripe.CouponCreateParams =
    campaign.discountKind === "FREE"
      ? { ...common, percent_off: 100 }
      : { ...common, amount_off: listPrice - charged, currency: "jpy" };

  const coupon = await getStripe().coupons.create(params, {
    idempotencyKey: `pricing_coupon_${campaign.id}_${campaign.version}_${months}_${plan}`,
  });

  try {
    await prisma.pricingCampaignCoupon.create({
      data: {
        campaignId: campaign.id,
        version: campaign.version,
        months,
        kind,
        plan,
        stripeCouponId: coupon.id,
      },
    });
    return coupon.id;
  } catch (error) {
    // 同時に2本の決済が走ったときは、先に保存された方を使う。
    const again = await prisma.pricingCampaignCoupon.findUnique({
      where: {
        campaignId_version_months_kind_plan: {
          campaignId: campaign.id,
          version: campaign.version,
          months,
          kind,
          plan,
        },
      },
    });
    if (again) return again.stripeCouponId;
    throw error;
  }
}

/** 0円の単発チケットを、この人があと何回受け取れるか。 */
export async function remainingFreeGrants(
  userId: string,
  campaignId: string,
): Promise<number> {
  const [campaign, used] = await Promise.all([
    prisma.pricingCampaign.findUnique({ where: { id: campaignId } }),
    prisma.billingTransaction.count({
      where: {
        userId,
        campaignId,
        paymentType: "ONE_TIME",
        paymentStatus: "SUCCEEDED",
        amount: 0,
      },
    }),
  ]);
  if (!campaign) return 0;
  return Math.max(0, campaign.freePerUserLimit - used);
}
