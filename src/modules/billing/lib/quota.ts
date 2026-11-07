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
  draftEventLimitOf,
  type DraftPlanId,
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
  /** 8件まで公開プランだけが持つ、同時に公開できる上限。 */
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
      "8件まで公開プラン",
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
      "公開し放題プラン",
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
    toOption("SUBSCRIPTION_8", "8件まで公開プラン", quotes.subscription8, {
      interval: "month",
      eventLimit: SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
    }),
    toOption("SUBSCRIPTION_UNLIMITED", "公開し放題プラン", quotes.subscriptionUnlimited, {
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

/**
 * チケットを1枚消費した結果。
 *
 * `ticketId` は、期限つきの無料チケットで通したときだけ入る。即公開はイベント行より先に
 * チケットを消費するので、作成後に `free_tickets.event_id` を結ぶために呼び出し側へ返す。
 */
export interface QuotaConsumption {
  type: QuotaPlanType;
  ticketId: string | null;
}

export interface QuotaDecision {
  type: QuotaPlanType;
  consume: (tx: Prisma.TransactionClient) => Promise<QuotaConsumption>;
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

/** どのチケットで消費したかを、イベントに残す値へ写す。 */
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
 * 公開中のイベント数。8件まで公開プランの上限は、この件数で判定する。
 *
 * 数えるのは、公開済みで、削除されておらず、開催日が今日以降のもの。
 * 受付を一時停止（CLOSED）したものは、告知ページが残っていても数えない。
 * 単発チケットと無料チケットで公開したものは件数に数えないので含めない。
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

/**
 * 画面に出す「公開中のイベント」の件数。
 *
 * 件数の上限の判定（`countPublishedSubscriptionEvents`）と違い、どのチケットから公開したものも数える。
 * 公開し放題プランと未加入の帯にも件数を出すため。数える範囲は同じで、公開済み・未削除・
 * 開催日が今日以降・自分の筆頭幹事のものだけ。
 */
export async function countPublishedEvents(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
  now = new Date(),
): Promise<number> {
  return db.event.count({
    where: {
      status: "PUBLISHED",
      isDeleted: false,
      schedules: { some: { eventDate: { gte: jstToday(now) } } },
      organizers: { some: { userId, role: "OWNER" } },
    },
  });
}

/**
 * 自分の下書きの件数。
 *
 * 数えるのは、下書きで、削除されておらず、自分が筆頭幹事（OWNER）のもの。
 * 開催日は問わない（過去日の下書きも枠を食う）。共同主催だけの下書きは数えない
 * （一覧には出るが、削除は筆頭幹事しかできないため、数えると消せない枠になる）。
 */
export async function countDraftEvents(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
): Promise<number> {
  return db.event.count({
    where: {
      status: "DRAFT",
      isDeleted: false,
      organizers: { some: { userId, role: "OWNER" } },
    },
  });
}

/**
 * 新しい下書きを保存できるか。上限に達していたら 403 を投げる。
 *
 * 402 は使わない。402 は課金で解ける合図として `PricingModal` が受けており、
 * 下書きの枠は削除で解けるため。既存の下書きの保存・復元はこの判定を通さない。
 */
export async function assertCanSaveDraft(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
  now = new Date(),
): Promise<void> {
  const quota = await db.userUsageQuota.findUnique({
    where: { userId },
    select: {
      subscriptionStatus: true,
      subscriptionPlan: true,
      currentPeriodEnd: true,
      paidCredits: true,
    },
  });
  const subscriptionActive = quota
    ? isSubscriptionActive(quota.subscriptionStatus, quota.currentPeriodEnd, now)
    : false;
  const plan: DraftPlanId = subscriptionActive
    ? quota?.subscriptionPlan === "MONTHLY_8"
      ? "monthly-8"
      : "unlimited"
    : "free";
  const limit = draftEventLimitOf(plan, (quota?.paidCredits ?? 0) > 0);
  const count = await countDraftEvents(db, userId);
  if (count < limit) return;
  throw new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    type: "probs/draft-limit-reached",
    detail: `下書きは${limit}件までです。公開するか、いらない下書きを削除してください。`,
    error: "DRAFT_LIMIT_REACHED",
    // 画面が上限の件数を出すために添える。
    draftLimit: limit,
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
      `無料チケット${FREE_EVENT_LIMIT}枚を使い切りました。単発 ${yen(single)} ／ 8件まで公開プラン ${yen(monthly8)} ／ 公開し放題プラン ${yen(unlimited)} から選べます。`,
    error: "QUOTA_EXCEEDED",
    pricingOptions: pricing,
  });
}

/** 8件まで公開プランの上限に達したときの 402。公開し放題プランへの変更を促す。 */
export function publishedEventsFull(options?: QuotaPricingOption[]): ProblemDetailException {
  const pricing = options ?? PRICING_OPTIONS;
  const unlimited =
    pricing.find((option) => option.type === "SUBSCRIPTION_UNLIMITED")?.price ??
    SUBSCRIPTION_UNLIMITED_PRICE_JPY;
  return new ProblemDetailException({
    status: 402,
    title: "Payment Required",
    type: "probs/quota-exceeded",
    detail: `公開中のイベントが${SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件に達しました。終わったものを削除するか止めてください。公開し放題プラン（${yen(unlimited)}）へ変えることもできます。`,
    error: "PUBLISHED_EVENTS_FULL",
    pricingOptions: pricing,
  });
}

function phoneRequired(): ProblemDetailException {
  return new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    detail: "無料チケットを使うには電話番号の確認が必要です。会員登録で確認してください。",
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
      detail: "主催者のチケット情報が存在しません。",
    });
  }
}

/**
 * 期限内のチケットを1枚だけ使い、その id を返す。無ければ null。
 *
 * `lockQuotaRow` の内側で呼ぶこと。判定と更新を1つの条件で行い、
 * 同時押しで同じ券を2回使わないようにする（`usedAt: null` と `expiresAt > now`）。
 * 期限が最も近い券から使うのは、期限切れで捨てる枚数を減らすため。
 */
async function claimFreeTicket(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  eventId: string | null,
): Promise<{ id: string } | null> {
  const candidate = await tx.freeTicket.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await tx.freeTicket.updateMany({
    where: { id: candidate.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now, ...(eventId ? { eventId } : {}) },
  });
  return claimed.count === 1 ? candidate : null;
}

/**
 * チケットを1枚消費する。公開の直前に、イベントと同じトランザクションで呼ぶ。
 *
 * 消費順は「定額 → チケット（期限が近い順） → 単発クレジット → 無料チケット」。
 * 8件まで公開プランは、公開中のイベントが上限未満なら通す。
 * 上限に達していても単発クレジットかチケットがあれば、そちらを1枚使って通す。
 * 公開し放題プランは件数を数えない。
 *
 * `eventId` はチケットにイベントを結ぶためだけに使う。まだイベント行が無い
 * 即公開の経路では null を渡し、作成できた時点で呼び出し側が結ぶ。
 */
export async function consumeEventQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  eventId: string | null = null,
): Promise<QuotaConsumption> {
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
    if (quota.subscriptionPlan !== "MONTHLY_8") {
      return { type: "SUBSCRIPTION_UNLIMITED", ticketId: null };
    }

    const published = await countPublishedSubscriptionEvents(tx, userId, now);
    if (published < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT) {
      return { type: "SUBSCRIPTION_MONTHLY_8", ticketId: null };
    }
  }

  // 期限がある券を、期限の無い単発クレジットより先に使う。後ろに置くと期限切れで捨てる。
  const ticket = await claimFreeTicket(tx, userId, now, eventId);
  if (ticket) return { type: "PAID_CREDIT", ticketId: ticket.id };

  if (quota.paidCredits >= 1) {
    await tx.userUsageQuota.update({
      where: { userId },
      data: { paidCredits: { decrement: 1 } },
    });
    return { type: "PAID_CREDIT", ticketId: null };
  }

  // 無料チケットは加入前のためのもの。8件プランの上限に達した人が無料チケットで抜け道を作らない。
  if (!subscriptionActive && quota.freeEventCount < FREE_EVENT_LIMIT) {
    if (!(await hasVerifiedPhone(tx, userId))) throw phoneRequired();
    await tx.userUsageQuota.update({
      where: { userId },
      data: { freeEventCount: { increment: 1 } },
    });
    return { type: "FREE_TRIAL", ticketId: null };
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
      detail: "主催者のチケット情報が存在しません。",
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
  // 公開中の件数を見るのは8件プランだけ。公開し放題プランは数えない。
  const capped =
    subscriptionActive &&
    quota.subscriptionPlan === "MONTHLY_8" &&
    (await countPublishedSubscriptionEvents(prisma, userId, now)) >=
      SUBSCRIPTION_PUBLISHED_EVENT_LIMIT;
  const subscriptionOk = subscriptionActive && !capped;
  const creditOk = quota.paidCredits >= 1;
  // 期限内のチケットも1枚として数える。数えないと、券を持っているのに
  // 「作成できない」と表示され、402 の画面へ誘導されてしまう。
  // 定額か単発クレジットで通るなら数える必要がないので、そのときは問い合わせない。
  const ticketOk =
    !subscriptionOk &&
    !creditOk &&
    (await prisma.freeTicket.count({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
    })) > 0;
  // 無料チケットは加入前のためのもの。加入中は、上限に達しても無料チケットでは抜けない。
  const freeOk = !subscriptionActive && quota.freeEventCount < FREE_EVENT_LIMIT;
  if (
    !subscriptionOk &&
    !creditOk &&
    !ticketOk &&
    freeOk &&
    !(await hasVerifiedPhone(prisma, userId))
  ) {
    throw phoneRequired();
  }
  if (!subscriptionOk && !creditOk && !ticketOk && !freeOk) {
    const pricing = await loadPricingOptions(now);
    throw capped ? publishedEventsFull(pricing) : quotaExceeded(undefined, pricing);
  }

  const preview: QuotaPlanType = subscriptionOk
    ? quota.subscriptionPlan === "MONTHLY_8"
      ? "SUBSCRIPTION_MONTHLY_8"
      : "SUBSCRIPTION_UNLIMITED"
    : creditOk || ticketOk
      ? "PAID_CREDIT"
      : "FREE_TRIAL";

  return {
    type: preview,
    consume: async (tx) => consumeEventQuota(tx, userId),
  };
}
