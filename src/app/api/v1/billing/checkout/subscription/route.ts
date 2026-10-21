import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { appBaseUrl, toErrorResponse } from "@/lib/http";
import { SUBSCRIPTION_PRICE_JPY } from "@/modules/billing/lib/plans";
import { ensureStripeCustomer } from "@/modules/billing/lib/billing";
import { getStripe, checkoutIdempotencyKey } from "@/modules/billing/lib/stripe";
import { ensureCampaignCoupon, loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { discountMonths, quoteFor } from "@/modules/billing/lib/pricing";
import { isSubscriptionActive } from "@/modules/billing/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const priceId = process.env.STRIPE_PRICE_ID_MONTHLY_980;
    if (!priceId) {
      throw new ProblemDetailException({
        status: 500,
        title: "Internal Server Error",
        detail: "月額プランの Stripe Price ID が設定されていません。",
      });
    }

    const now = new Date();
    const quota = await prisma.userUsageQuota.findUnique({ where: { userId } });
    if (quota && isSubscriptionActive(quota.subscriptionStatus, quota.currentPeriodEnd, now)) {
      throw new ProblemDetailException({
        status: 409,
        title: "Conflict",
        detail: "すでに月額プランに加入しています。プランの変更はマイページから行えます。",
        error: "ALREADY_SUBSCRIBED",
      });
    }

    const quote = quoteFor("SUBSCRIPTION", await loadActiveCampaigns(now), now);
    const campaign = quote.campaignId
      ? await prisma.pricingCampaign.findUnique({ where: { id: quote.campaignId } })
      : null;

    let couponId: string | null = null;
    if (campaign && quote.discountPercent > 0) {
      const months = discountMonths(now, campaign.endsAt);
      if (months < 1) {
        throw new ProblemDetailException({
          status: 409,
          title: "Conflict",
          detail: "キャンペーンの受付は終了しました。",
          error: "CAMPAIGN_ENDED",
        });
      }
      couponId = await ensureCampaignCoupon(campaign, months);
    }

    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(userId);
    const appUrl = appBaseUrl();
    const idempotencyKey = checkoutIdempotencyKey(req, userId, "subscription");
    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ["card"],
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        // 0円の無料期間でもカードを登録しておき、期間終了後は自動で請求する。
        payment_method_collection: "always",
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
        success_url: `${appUrl}/organizer/events/new?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/organizer/events/new`,
        client_reference_id: userId,
        metadata: {
          userId,
          paymentType: "SUBSCRIPTION",
          ...(campaign
            ? { campaignId: campaign.id, appliedPercent: String(quote.discountPercent) }
            : {}),
        },
        subscription_data: {
          metadata: {
            userId,
            ...(campaign ? { campaignId: campaign.id } : {}),
          },
        },
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    if (!session.url) {
      throw new ProblemDetailException({
        status: 500,
        title: "Internal Server Error",
        detail: "Stripe Checkout の URL を発行できませんでした。",
      });
    }

    const data = {
      userId,
      paymentType: "SUBSCRIPTION" as const,
      paymentStatus: "PENDING" as const,
      amount: quote.chargedPrice,
      listAmount: SUBSCRIPTION_PRICE_JPY,
      discountAmount: quote.discountAmount,
      campaignId: quote.campaignId,
      appliedPercent: quote.discountPercent > 0 ? quote.discountPercent : null,
      stripeCouponId: couponId,
      requestKey: idempotencyKey ?? null,
      currency: "jpy",
    };
    await prisma.billingTransaction.upsert({
      where: { stripeCheckoutSessionId: session.id },
      create: { ...data, stripeCheckoutSessionId: session.id },
      update: data,
    });

    return NextResponse.json({ checkoutUrl: session.url, pricing: quote });
  } catch (error) {
    if (error instanceof Error && error.message === "STRIPE_SECRET_KEY is not set") {
      return toErrorResponse(
        new ProblemDetailException({
          status: 500,
          title: "Internal Server Error",
          detail: "Stripe の秘密鍵が設定されていません。",
        }),
        "/api/v1/billing/checkout/subscription",
      );
    }
    return toErrorResponse(error, "/api/v1/billing/checkout/subscription");
  }
}
