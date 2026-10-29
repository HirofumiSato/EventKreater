import type { Prisma, QuotaSource, SubscriptionStatus } from "@prisma/client";
import { yen } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import {
  FREE_EVENT_LIMIT,
  ONE_TIME_PRICE_JPY,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
} from "@/modules/billing/lib/plans";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteAll } from "@/modules/billing/lib/pricing";

export {
  FREE_EVENT_LIMIT,
  ONE_TIME_PRICE_JPY,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
};

/** 402 のときに画面へ返す選択肢。割引中は price が請求額、listPrice が定価。 */
export interface QuotaPricingOption {
  type: "SINGLE" | "SUBSCRIPTION_8" | "SUBSCRIPTION_UNLIMITED";
  name: string;
  price: number;
  listPrice: number;
  discountPercent: number;
  campaignName: string | null;
  currency: "JPY";
  interval?: "month";
  /** 月額で8件まで公開プランだけが持つ、同時に公開できる上限。 */
  eventLimit?: number;
}

function toOption(
  type: QuotaPricingOption["type"],
  name: string,
  quote: {
    chargedPrice: number;
    listPrice: number;
    discountPercent: number;
    campaignName: string | null;
  },
  extra: { interval?: "month"; eventLimit?: number } = {},
): QuotaPricingOption {
  return {
    type,
    name,
    price: quote.chargedPrice,
    listPrice: quote.listPrice,
    discountPercent: quote.discountPercent,
    campaignName: quote.campaignName,
    currency: "JPY",
    ...extra,
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
      "SUBSCRIPTION_8",
      "月額で8件まで公開プラン",
      {
        chargedPrice: SUBSCRIPTION_8_PRICE_JPY,
        listPrice: SUBSCRIPTION_8_PRICE_JPY,
        discountPercent: 0,
        campaignName: null,
      },
      { interval: "month", eventLimit: SUBSCRIPTION_PUBLISHED_EVENT_LIMIT },
    ),
    toOption(
      "SUBSCRIPTION_UNLIMITED",
      "公開し放題",
      {
        chargedPrice: SUBSCRIPTION_UNLIMITED_PRICE_JPY,
        listPrice: SUBSCRIPTION_UNLIMITED_PRICE_JPY,
        discountPercent: 0,
        campaignName: null,
      },
      { interval: "month" },
    ),
  ];
}

export async function loadPricingOptions(now = new Date()): Promise<QuotaPricingOption[]> {
  const quotes = quoteAll(await loadActiveCampaigns(now), now);
  return [
    toOption("SINGLE", "単発生成チケット", quotes.oneTime),
    toOption("SUBSCRIPTION_8", "月額で8件まで公開プラン", quotes.subscription8, {
      interval: "month",
      eventLimit: SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
    }),
    toOption("SUBSCRIPTION_UNLIMITED", "公開し放題", quotes.subscriptionUnlimited, {
      interval: "month",
    }),
  ];
}

export const PRICING_OPTIONS = basePricingOptions();

export type QuotaPlanType =
  | "SUBSCRIPTION_UNLIMITED"
  | "SUBSCRIPTION_MONTHLY_8"
  | "PAID_CREDIT"
  | "FREE_TRIAL";

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

/**
 * 日本時間の「今日」を、UTC 0 時の Date で返す。
 * 開催日（`EventSchedule.eventDate`）は年月日を UTC 0 時で持つので、比較の土台を揃える。
 */
export function jstToday(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
}

/** どの利用枠で消費したかを、イベントに残す値へ写す。 */
export function quotaSourceOf(type: QuotaPlanType): QuotaSource {
  switch (type) {
    case "FREE_TRIAL":
      return "FREE_TRIAL";
    case "PAID_CREDIT":
      return "PAID_CREDIT";
    case "SUBSCRIPTION_MONTHLY_8":
    case "SUBSCRIPTION_UNLIMITED":
      return "SUBSCRIPTION";
  }
}

/**
 * 公開中のイベント数。月額で8件まで公開プランの上限は、この件数で判定する。
 *
 * 数えるのは、公開済みで、削除されておらず、開催日が今日以降のもの。
 * 受付を一時停止（CLOSED）したものは、告知ページが残っていても数えない。
 * 単発と無料枠で公開したものは枠の外なので含めない。
 */
export async function countPublishedSubscriptionEvents(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
  now = new Date(),
): Promise<number> {
  return db.event.count({
    where: {
      status: "PUBLISHED",
      isDeleted: false,
      quotaSource: "SUBSCRIPTION",
      schedules: { some: { eventDate: { gte: jstToday(now) } } },
      organizers: { some: { userId, role: "OWNER" } },
    },
  });
}

export function quotaExceeded(
  detail?: string,
  options?: QuotaPricingOption[],
): ProblemDetailException {
  const pricing = options ?? PRICING_OPTIONS;
  const single = pricing.find((option) => option.type === "SINGLE")?.price ?? ONE_TIME_PRICE_JPY;
  const monthly8 =
    pricing.find((option) => option.type === "SUBSCRIPTION_8")?.price ?? SUBSCRIPTION_8_PRICE_JPY;
  const unlimited =
    pricing.find((option) => option.type === "SUBSCRIPTION_UNLIMITED")?.price ??
    SUBSCRIPTION_UNLIMITED_PRICE_JPY;
  return new ProblemDetailException({
    status: 402,
    title: "Payment Required",
    type: "probs/quota-exceeded",
    detail:
      detail ??
      `無料トライアル枠（${FREE_EVENT_LIMIT}回）が上限に達しています。単発チケット（${yen(single)}）、月額で8件まで公開プラン（${yen(monthly8)}）、公開し放題（${yen(unlimited)}）のいずれかをご利用ください。`,
    error: "QUOTA_EXCEEDED",
    pricingOptions: pricing,
  });
}

/** 月額で8件まで公開プランの上限に達したときの 402。公開し放題への変更を促す。 */
export function publishedEventsFull(options?: QuotaPricingOption[]): ProblemDetailException {
  const pricing = options ?? PRICING_OPTIONS;
  const single = pricing.find((option) => option.type === "SINGLE")?.price ?? ONE_TIME_PRICE_JPY;
  const unlimited =
    pricing.find((option) => option.type === "SUBSCRIPTION_UNLIMITED")?.price ??
    SUBSCRIPTION_UNLIMITED_PRICE_JPY;
  return new ProblemDetailException({
    status: 402,
    title: "Payment Required",
    type: "probs/quota-exceeded",
    detail: `公開中のイベントが${SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件に達しました。終わったイベントを削除するか、公開を一時停止するか、公開し放題（${yen(unlimited)}）へ変更してください。単発チケット（${yen(single)}）で1件だけ足すこともできます。`,
    error: "PUBLISHED_EVENTS_FULL",
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

/**
 * 枠を1つ消費する。公開の直前に、イベントと同じトランザクションで呼ぶ。
 *
 * 月額で8件まで公開プランは、公開中のイベントが上限未満なら通す。
 * 上限に達していても単発クレジットがあれば、そちらを1つ使って通す。
 * 公開し放題は件数を数えない。
 */
export async function consumeEventQuota(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<QuotaPlanType> {
  await lockQuotaRow(tx, userId);
  const quota = await tx.userUsageQuota.findUniqueOrThrow({ where: { userId } });
  const now = new Date();

  const pricing = await loadPricingOptions(now);

  if (quota.subscriptionStatus === "PAST_DUE") {
    throw quotaExceeded(
      "月額プランのお支払いに問題があるため、イベントを公開できません。お支払い方法を更新してください。",
      pricing,
    );
  }

  const subscriptionActive = isSubscriptionActive(
    quota.subscriptionStatus,
    quota.currentPeriodEnd,
    now,
  );

  if (subscriptionActive) {
    if (quota.subscriptionPlan !== "MONTHLY_8") return "SUBSCRIPTION_UNLIMITED";

    const published = await countPublishedSubscriptionEvents(tx, userId, now);
    if (published < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT) return "SUBSCRIPTION_MONTHLY_8";
  }

  if (quota.paidCredits >= 1) {
    await tx.userUsageQuota.update({
      where: { userId },
      data: { paidCredits: { decrement: 1 } },
    });
    return "PAID_CREDIT";
  }

  // 無料枠は加入前のためのもの。8件プランの上限に達した人が無料枠で抜け道を作らない。
  if (!subscriptionActive && quota.freeEventCount < FREE_EVENT_LIMIT) {
    if (!(await hasVerifiedPhone(tx, userId))) throw phoneRequired();
    await tx.userUsageQuota.update({
      where: { userId },
      data: { freeEventCount: { increment: 1 } },
    });
    return "FREE_TRIAL";
  }

  const capped = subscriptionActive && quota.subscriptionPlan === "MONTHLY_8";
  throw capped ? publishedEventsFull(pricing) : quotaExceeded(undefined, pricing);
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

  const subscriptionActive = isSubscriptionActive(
    quota.subscriptionStatus,
    quota.currentPeriodEnd,
    now,
  );
  // 公開中の件数を見るのは8件プランだけ。公開し放題は数えない。
  const capped =
    subscriptionActive &&
    quota.subscriptionPlan === "MONTHLY_8" &&
    (await countPublishedSubscriptionEvents(prisma, userId, now)) >=
      SUBSCRIPTION_PUBLISHED_EVENT_LIMIT;
  const subscriptionOk = subscriptionActive && !capped;
  const creditOk = quota.paidCredits >= 1;
  // 無料枠は加入前のためのもの。加入中は、上限に達しても無料枠では抜けない。
  const freeOk = !subscriptionActive && quota.freeEventCount < FREE_EVENT_LIMIT;
  if (!subscriptionOk && !creditOk && freeOk && !(await hasVerifiedPhone(prisma, userId))) {
    throw phoneRequired();
  }
  if (!subscriptionOk && !creditOk && !freeOk) {
    const pricing = await loadPricingOptions(now);
    throw capped ? publishedEventsFull(pricing) : quotaExceeded(undefined, pricing);
  }

  const preview: QuotaPlanType = subscriptionOk
    ? quota.subscriptionPlan === "MONTHLY_8"
      ? "SUBSCRIPTION_MONTHLY_8"
      : "SUBSCRIPTION_UNLIMITED"
    : creditOk
      ? "PAID_CREDIT"
      : "FREE_TRIAL";

  return {
    type: preview,
    consume: async (tx) => consumeEventQuota(tx, userId),
  };
}
