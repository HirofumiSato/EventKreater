import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { FREE_EVENT_LIMIT, isSubscriptionActive } from "@/modules/billing/lib/quota";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteBoth } from "@/modules/billing/lib/pricing";

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
    const canCreate =
      quota.subscriptionStatus !== "PAST_DUE" &&
      (isSubActive || quota.paidCredits > 0 || (remainingFree > 0 && phoneVerified));

    let planType: "FREE_TRIAL" | "PAID_CREDIT" | "SUBSCRIPTION" | "NONE" = "NONE";
    if (isSubActive) planType = "SUBSCRIPTION";
    else if (quota.paidCredits > 0) planType = "PAID_CREDIT";
    else if (remainingFree > 0) planType = "FREE_TRIAL";

    const pricing = quoteBoth(campaigns, now);

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
