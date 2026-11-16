import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const now = new Date();
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

    return NextResponse.json({
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
    },
    {
      // 画面を開くたびに同じ値を取りに行くので、30 秒だけブラウザに持たせる。
      // 応答は会員ごとに違い、共有キャッシュに載せてはいけない（`private`）。
      // 付与・公開の直後に読み直す呼び出しは `useEventQuota` が `cache: "no-store"` で飛ばす。
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/billing/quota");
  }
}
