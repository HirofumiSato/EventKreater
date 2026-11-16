import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import type { QuotaSeed, UserQuota } from "@/modules/events/types";
import {
  FREE_EVENT_LIMIT,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  countDraftEvents,
  countPublishedEvents,
  countPublishedSubscriptionEvents,
  isSubscriptionActive,
} from "@/modules/billing/lib/quota";
import { draftEventLimitOf, type DraftPlanId } from "@/modules/billing/lib/plans";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteAll } from "@/modules/billing/lib/pricing";
import { readTicketSummary } from "@/modules/billing/lib/referral";
import { isTrialEligible } from "@/modules/billing/lib/trial";

/**
 * 画面と API に出す、チケット・プランの残り。
 *
 * `GET /api/v1/billing/quota` の本体をここへ置き、ルート（API）と画面（サーバー
 * コンポーネント）の両方が同じ 1 本を読む。2 か所で数え方を書き分けると、
 * 最初の HTML と応答が食い違い、開いた直後に件数が変わる。
 *
 * 数え上げは 2 ウェーブ。1 ウェーブ目でクォータ行・会員・販売価格・チケット・
 * 決済済みの月額を引き、その値で下書きの枠と数え上げの条件を決めてから 2 ウェーブ目を投げる。
 */
export async function loadQuotaView(userId: string, now = new Date()): Promise<UserQuota> {
  // 1 ウェーブ目。チケットの残り・会員・販売価格・初月無料の使用履歴は互いに依存しない。
  // 初月無料の資格は `resolveTrial` を使わない（同じ `user_usage_quotas` をもう一度読むため）。
  // ここで引いた行から `isTrialEligible` に渡す。
  const [quota, user, campaigns, tickets, priorSubscriptions] = await Promise.all([
    prisma.userUsageQuota.findUnique({
      where: { userId },
      include: { pricingCampaign: { select: { id: true, name: true } } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true } }),
    loadActiveCampaigns(now),
    readTicketSummary(userId, now),
    // 決済済みの月額だけを数える。`PENDING` は放棄した Checkout が残るので数えない。
    prisma.billingTransaction.count({
      where: { userId, paymentType: "SUBSCRIPTION", paymentStatus: "SUCCEEDED" },
    }),
  ]);
  if (!quota) {
    throw new ProblemDetailException({
      status: 404,
      title: "Quota Not Found",
      detail: "主催者のチケット情報が存在しません。",
      error: "QUOTA_NOT_FOUND",
    });
  }

  const isSubActive = isSubscriptionActive(quota.subscriptionStatus, quota.currentPeriodEnd, now);
  const remainingFree = Math.max(0, FREE_EVENT_LIMIT - quota.freeEventCount);
  const phoneVerified = Boolean(user?.phoneVerifiedAt);
  // 公開中の件数は、どのプランの帯にも出す。8件まで公開プランだけは、
  // 残りの計算と食い違わないよう、件数の上限の判定と同じ数え方（定額から公開したものだけ）にする。
  const countedPlan = isSubActive && quota.subscriptionPlan === "MONTHLY_8";
  // 期限つきの無料チケット。残数は `freeGrantRemaining`（0円キャンペーンの残り）と混ぜない。
  const ticketAvailable = tickets.available;

  // 下書きの枠。公開の可否（canCreate）とは別で、既存の下書きの保存は常に通す。
  // 放題プランも 30 件を返し、画面が N / 30 と出せるようにする。
  const draftPlan: DraftPlanId = isSubActive
    ? quota.subscriptionPlan === "MONTHLY_8"
      ? "monthly-8"
      : "unlimited"
    : "free";
  const draftEventLimit = draftEventLimitOf(draftPlan, quota.paidCredits > 0);

  const pricing = quoteAll(campaigns, now);
  const oneTimeCampaignId = pricing.oneTime.chargedPrice === 0 ? pricing.oneTime.campaignId : null;

  // 2 ウェーブ目。数え上げの条件は 1 ウェーブ目で決まるので、まとめて投げる。
  const [publishedCount, draftEventCount, freeGrantUsed] = await Promise.all([
    countedPlan
      ? countPublishedSubscriptionEvents(prisma, userId, now)
      : countPublishedEvents(prisma, userId, now),
    countDraftEvents(prisma, userId),
    // 0円の単発チケットを、この人があと何枚受け取れるか。
    oneTimeCampaignId
      ? prisma.billingTransaction.count({
          where: {
            userId,
            campaignId: oneTimeCampaignId,
            paymentType: "ONE_TIME",
            paymentStatus: "SUCCEEDED",
            amount: 0,
          },
        })
      : Promise.resolve(0),
  ]);

  const remainingPublished = countedPlan
    ? Math.max(0, SUBSCRIPTION_PUBLISHED_EVENT_LIMIT - publishedCount)
    : null;
  const cappedByPlan = countedPlan && (remainingPublished ?? 0) === 0;
  const canCreate =
    quota.subscriptionStatus !== "PAST_DUE" &&
    ((isSubActive && !cappedByPlan) ||
      quota.paidCredits > 0 ||
      ticketAvailable > 0 ||
      (!isSubActive && remainingFree > 0 && phoneVerified));
  const remainingDrafts = Math.max(0, draftEventLimit - draftEventCount);
  const canSaveDraft = remainingDrafts > 0;

  let planType:
    | "FREE_TRIAL"
    | "PAID_CREDIT"
    | "SUBSCRIPTION_MONTHLY_8"
    | "SUBSCRIPTION_UNLIMITED"
    | "NONE" = "NONE";
  if (isSubActive) {
    planType = quota.subscriptionPlan === "MONTHLY_8" ? "SUBSCRIPTION_MONTHLY_8" : "SUBSCRIPTION_UNLIMITED";
  } else if (quota.paidCredits > 0) planType = "PAID_CREDIT";
  else if (remainingFree > 0) planType = "FREE_TRIAL";

  const freeGrantRemaining = oneTimeCampaignId
    ? Math.max(0, (pricing.oneTime.freePerUserLimit ?? 1) - freeGrantUsed)
    : 0;

  const discount =
    quota.discountPercent && quota.discountEndsAt && quota.discountEndsAt > now
      ? {
          percent: quota.discountPercent,
          endsAt: quota.discountEndsAt.toISOString(),
          campaignId: quota.pricingCampaignId,
          campaignName: quota.pricingCampaign?.name ?? null,
        }
      : null;

  // 初月無料の無料期間中だけ `trial` を持つ。加入中は新しく使えないので trialEligible は false。
  const trial =
    quota.trialEndsAt && quota.trialEndsAt > now
      ? { endsAt: quota.trialEndsAt.toISOString() }
      : null;
  // 初月無料は「はじめての月額加入」に1回だけ。加入中は判定しない（読み直しもしない）。
  const trialEligible = isSubActive
    ? false
    : isTrialEligible({
        trialUsedAt: quota.trialUsedAt,
        stripeSubscriptionId: quota.stripeSubscriptionId,
        priorSubscriptions,
      });

  return {
    freeEventCount: quota.freeEventCount,
    freeLimit: FREE_EVENT_LIMIT,
    remainingFree,
    paidCredits: quota.paidCredits,
    subscriptionStatus: quota.subscriptionStatus,
    subscriptionPlan: quota.subscriptionPlan,
    publishedEventCount: publishedCount,
    publishedEventLimit: SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
    remainingPublished,
    currentPeriodEnd: quota.currentPeriodEnd ? quota.currentPeriodEnd.toISOString() : null,
    canCreate,
    // 下書きの件数と枠。`canSaveDraft` はログイン済みかではなく、枠が空いているか。
    draftEventCount,
    draftEventLimit,
    remainingDrafts,
    canSaveDraft,
    planType,
    phoneVerified,
    pricing,
    freeGrantRemaining,
    tickets,
    discount,
    trial,
    trialEligible,
  };
}

/**
 * 画面へ渡すクォータの初期値。失敗を握り潰す場所を 1 か所にまとめる。
 *
 * 未ログインは取りに行かない（`signed-out`）。読めなかったときは `unknown` にして、
 * 画面は今までどおりクライアントで取り直す。クォータ行が無い会員は API も 404 なので、
 * `unknown` に落としても帯が出ない挙動は今と同じ（API の 404 は `useEventQuota` が受ける）。
 */
export async function loadQuotaSeed(userId: string | null): Promise<QuotaSeed> {
  if (!userId) return { status: "signed-out" };
  try {
    return { status: "ready", quota: await loadQuotaView(userId) };
  } catch (error) {
    // クォータ行の無い会員は API も 404。想定内なので黙って `unknown` に落とす。
    // それ以外は、画面が古い残数のまま進む前に、サーバーのログに残す。
    const expected = error instanceof ProblemDetailException && error.status === 404;
    if (!expected) console.error("クォータの初期値を読めませんでした", error);
    return { status: "unknown" };
  }
}
