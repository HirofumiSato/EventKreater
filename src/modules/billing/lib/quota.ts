import type { Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { FREE_EVENT_LIMIT, ONE_TIME_PRICE_JPY, SUBSCRIPTION_PRICE_JPY } from "@/modules/billing/lib/plans";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteBoth } from "@/modules/billing/lib/pricing";

export { FREE_EVENT_LIMIT, ONE_TIME_PRICE_JPY, SUBSCRIPTION_PRICE_JPY };

/** 402 のときに画面へ返す選択肢。割引中は price が請求額、listPrice が定価。 */
export interface QuotaPricingOption {
  type: "SINGLE" | "SUBSCRIPTION";
  name: string;
  price: number;
  listPrice: number;
  discountPercent: number;
  campaignName: string | null;
  currency: "JPY";
  interval?: "month";
}

function toOption(
  type: "SINGLE" | "SUBSCRIPTION",
  name: string,
  quote: {
    chargedPrice: number;
    listPrice: number;
    discountPercent: number;
    campaignName: string | null;
  },
  interval?: "month",
): QuotaPricingOption {
  return {
    type,
    name,
    price: quote.chargedPrice,
    listPrice: quote.listPrice,
    discountPercent: quote.discountPercent,
    campaignName: quote.campaignName,
    currency: "JPY",
    ...(interval ? { interval } : {}),
  };
}

/** キャンペーンを見に行けない場面（表示だけ）で使う定価の選択肢。 */
export function basePricingOptions(): QuotaPricingOption[] {
  return [
    toOption("SINGLE", "単発生成チケット", {
      chargedPrice: ONE_TIME_PRICE_JPY,
      listPrice: ONE_TIME_PRICE_JPY,
      discountPercent: 0,
      campaignName: null,
    }),
    toOption(
      "SUBSCRIPTION",
      "月額使い放題プラン",
      {
        chargedPrice: SUBSCRIPTION_PRICE_JPY,
        listPrice: SUBSCRIPTION_PRICE_JPY,
        discountPercent: 0,
        campaignName: null,
      },
      "month",
    ),
  ];
}

export async function loadPricingOptions(now = new Date()): Promise<QuotaPricingOption[]> {
  const quotes = quoteBoth(await loadActiveCampaigns(now), now);
  return [
    toOption("SINGLE", "単発生成チケット", quotes.oneTime),
    toOption("SUBSCRIPTION", "月額使い放題プラン", quotes.subscription, "month"),
  ];
}

export const PRICING_OPTIONS = basePricingOptions();


export type QuotaPlanType = "SUBSCRIPTION_UNLIMITED" | "PAID_CREDIT" | "FREE_TRIAL";

export interface QuotaDecision {
  type: QuotaPlanType;
  consume: (tx: Prisma.TransactionClient) => Promise<QuotaPlanType>;
}

export function isSubscriptionActive(
  status: SubscriptionStatus,
  currentPeriodEnd: Date | null,
  now = new Date(),
): boolean {
  return status === "ACTIVE" && currentPeriodEnd !== null && currentPeriodEnd > now;
}

export function quotaExceeded(
  detail?: string,
  options?: QuotaPricingOption[],
): ProblemDetailException {
  const pricing = options ?? PRICING_OPTIONS;
  const single = pricing.find((option) => option.type === "SINGLE")?.price ?? ONE_TIME_PRICE_JPY;
  const monthly =
    pricing.find((option) => option.type === "SUBSCRIPTION")?.price ?? SUBSCRIPTION_PRICE_JPY;
  return new ProblemDetailException({
    status: 402,
    title: "Payment Required",
    type: "probs/quota-exceeded",
    detail:
      detail ??
      `無料トライアル枠（${FREE_EVENT_LIMIT}回）が上限に達しています。単発チケット（${single.toLocaleString("ja-JP")}円）または月額プラン（${monthly.toLocaleString("ja-JP")}円）をご利用ください。`,
    error: "QUOTA_EXCEEDED",
    pricingOptions: pricing,
  });
}

function phoneRequired(): ProblemDetailException {
  return new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    detail: "無料枠を使うには電話番号の確認が必要です。会員登録画面で電話番号を確認してください。",
    error: "PHONE_REQUIRED",
  });
}

async function hasVerifiedPhone(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { phoneVerifiedAt: true },
  });
  return Boolean(user?.phoneVerifiedAt);
}

async function lockQuotaRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id FROM user_usage_quotas WHERE user_id = ${userId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new ProblemDetailException({
      status: 404,
      title: "Quota Not Found",
      detail: "主催者の利用枠情報が存在しません。",
    });
  }
}

export async function consumeEventQuota(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<QuotaPlanType> {
  await lockQuotaRow(tx, userId);
  const quota = await tx.userUsageQuota.findUniqueOrThrow({ where: { userId } });
  const now = new Date();

  if (quota.subscriptionStatus === "PAST_DUE") {
    throw quotaExceeded(
      "月額プランのお支払いに問題があるため、イベントを作成できません。お支払い方法を更新してください。",
      await loadPricingOptions(now),
    );
  }

  if (isSubscriptionActive(quota.subscriptionStatus, quota.currentPeriodEnd, now)) {
    return "SUBSCRIPTION_UNLIMITED";
  }

  if (quota.paidCredits >= 1) {
    await tx.userUsageQuota.update({
      where: { userId },
      data: { paidCredits: { decrement: 1 } },
    });
    return "PAID_CREDIT";
  }

  if (quota.freeEventCount < FREE_EVENT_LIMIT) {
    if (!(await hasVerifiedPhone(tx, userId))) throw phoneRequired();
    await tx.userUsageQuota.update({
      where: { userId },
      data: { freeEventCount: { increment: 1 } },
    });
    return "FREE_TRIAL";
  }

  throw quotaExceeded(undefined, await loadPricingOptions(now));
}

export async function assertCanCreateEvent(userId: string): Promise<QuotaDecision> {
  const quota = await prisma.userUsageQuota.findUnique({ where: { userId } });
  if (!quota) {
    throw new ProblemDetailException({
      status: 404,
      title: "Quota Not Found",
      detail: "主催者の利用枠情報が存在しません。",
    });
  }

  const now = new Date();
  if (quota.subscriptionStatus === "PAST_DUE") {
    throw quotaExceeded(
      "月額プランのお支払いに問題があるため、イベントを作成できません。お支払い方法を更新してください。",
      await loadPricingOptions(now),
    );
  }

  const subscriptionOk = isSubscriptionActive(quota.subscriptionStatus, quota.currentPeriodEnd, now);
  const creditOk = quota.paidCredits >= 1;
  const freeOk = quota.freeEventCount < FREE_EVENT_LIMIT;
  if (!subscriptionOk && !creditOk && freeOk && !(await hasVerifiedPhone(prisma, userId))) {
    throw phoneRequired();
  }
  if (!subscriptionOk && !creditOk && !freeOk) {
    throw quotaExceeded(undefined, await loadPricingOptions(now));
  }

  const preview: QuotaPlanType = subscriptionOk
    ? "SUBSCRIPTION_UNLIMITED"
    : creditOk
      ? "PAID_CREDIT"
      : "FREE_TRIAL";

  return {
    type: preview,
    consume: async (tx) => consumeEventQuota(tx, userId),
  };
}
