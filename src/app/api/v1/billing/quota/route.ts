import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import {
  FREE_EVENT_LIMIT,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  countPublishedSubscriptionEvents,
  isSubscriptionActive,
} from "@/modules/billing/lib/quota";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteAll } from "@/modules/billing/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const now = new Date();
    const [quota, user, campaigns] = await Promise.all([
      prisma.userUsageQuota.findUnique({
        where: { userId },
        include: { pricingCampaign: { select: { id: true, name: true } } },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true } }),
      loadActiveCampaigns(now),
    ]);
    if (!quota) {
      throw new ProblemDetailException({
        status: 404,
        title: "Quota Not Found",
        detail: "主催者の利用枠情報が存在しません。",
        error: "QUOTA_NOT_FOUND",
      });
    }

    const isSubActive = isSubscriptionActive(quota.subscriptionStatus, quota.currentPeriodEnd, now);
    const remainingFree = Math.max(0, FREE_EVENT_LIMIT - quota.freeEventCount);
    const phoneVerified = Boolean(user?.phoneVerifiedAt);
    // 公開中の件数を見るのは8件プランだけ。公開し放題は数えない。
    const countedPlan = isSubActive && quota.subscriptionPlan === "MONTHLY_8";
    const publishedCount = countedPlan
      ? await countPublishedSubscriptionEvents(prisma, userId, now)
      : 0;
    const remainingPublished = countedPlan
      ? Math.max(0, SUBSCRIPTION_PUBLISHED_EVENT_LIMIT - publishedCount)
      : null;
    const capped = countedPlan && (remainingPublished ?? 0) === 0;
    // 無料枠は加入前のためのもの。加入中は上限に達しても無料枠では抜けられないので、
    // 未加入のときだけ canCreate に数える。
    const canCreate =
      quota.subscriptionStatus !== "PAST_DUE" &&
      ((isSubActive && !capped) ||
        quota.paidCredits > 0 ||
        (!isSubActive && remainingFree > 0 && phoneVerified));

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

    const pricing = quoteAll(campaigns, now);

    // 0円の単発チケットを、この人があと何回受け取れるか。
    let freeGrantRemaining = 0;
    if (pricing.oneTime.chargedPrice === 0 && pricing.oneTime.campaignId) {
      const used = await prisma.billingTransaction.count({
        where: {
          userId,
          campaignId: pricing.oneTime.campaignId,
          paymentType: "ONE_TIME",
          paymentStatus: "SUCCEEDED",
          amount: 0,
        },
      });
      freeGrantRemaining = Math.max(0, (pricing.oneTime.freePerUserLimit ?? 1) - used);
    }

    const discount =
      quota.discountPercent && quota.discountEndsAt && quota.discountEndsAt > now
        ? {
            percent: quota.discountPercent,
            endsAt: quota.discountEndsAt.toISOString(),
            campaignId: quota.pricingCampaignId,
            campaignName: quota.pricingCampaign?.name ?? null,
          }
        : null;

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
      planType,
      phoneVerified,
      pricing,
      freeGrantRemaining,
      discount,
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/billing/quota");
  }
}
