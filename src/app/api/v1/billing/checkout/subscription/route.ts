import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { appBaseUrl, toErrorResponse } from "@/lib/http";
import { priceIdForPlan } from "@/modules/billing/lib/billing";
import { ensureStripeCustomer } from "@/modules/billing/lib/billing";
import { getStripe, checkoutIdempotencyKey } from "@/modules/billing/lib/stripe";
import { ensureCampaignCoupon, loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import {
  discountMonths,
  listPriceFor,
  pricingKindOfPlan,
  quoteFor,
  type SubscriptionProduct,
} from "@/modules/billing/lib/pricing";
import { isSubscriptionActive } from "@/modules/billing/lib/quota";
import { resolveTrial } from "@/modules/billing/lib/trial";
import { SubscriptionCheckoutSchema } from "@/lib/schemas";
import {
  DEFAULT_CHECKOUT_RETURN_TO,
  assertOwnDraft,
  checkoutReturnUrls,
} from "@/modules/billing/lib/checkout-intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 申込の既定。料金ページの主ボタンは公開し放題なので、指定が無ければそちら。 */
const DEFAULT_PLAN: SubscriptionProduct = "UNLIMITED";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const body = SubscriptionCheckoutSchema.parse(await req.json().catch(() => ({})));
    const plan: SubscriptionProduct = body.plan ?? DEFAULT_PLAN;
    const priceId = priceIdForPlan(plan);
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

    const quote = quoteFor(pricingKindOfPlan(plan), await loadActiveCampaigns(now), now);
    // 初月無料を使えるときは、月額のキャンペーンを併用しない（初月無料を優先する）。
    // キャンペーンは、初月無料を使えない再加入者にだけ効く。
    const trial = await resolveTrial(userId, now);
    const trialEnd = trial.eligible ? trial.endsAt : null;
    const campaign =
      trialEnd === null && quote.campaignId
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
      couponId = await ensureCampaignCoupon(campaign, months, plan);
    }

    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(userId);
    const appUrl = appBaseUrl();
    const idempotencyKey = checkoutIdempotencyKey(req, userId, `subscription_${plan}`);
    const intent = body;
    const returnTo = intent.returnTo ?? DEFAULT_CHECKOUT_RETURN_TO;
    if (intent.draftId) await assertOwnDraft(userId, intent.draftId);
    const { successUrl, cancelUrl } = checkoutReturnUrls(appUrl, returnTo, intent.draftId);
    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ["card"],
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        // 0円の無料期間でもカードを登録しておき、期間終了後は自動で請求する。
        payment_method_collection: "always",
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        metadata: {
          userId,
          paymentType: "SUBSCRIPTION",
          plan,
          ...(intent.draftId ? { draftId: intent.draftId } : {}),
          ...(intent.returnTo ? { returnTo } : {}),
          ...(campaign
            ? { campaignId: campaign.id, appliedPercent: String(quote.discountPercent) }
            : {}),
        },
        subscription_data: {
          // 初回だけ、加入から1か月を0円にする。2か月目からは定価で自動請求する。
          ...(trialEnd ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {}),
          metadata: {
            userId,
            plan,
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
      // 初月無料の申込は 0 円。定価と割引額は、あとから会計記録を辿れるように残す。
      amount: trialEnd ? 0 : quote.chargedPrice,
      listAmount: listPriceFor(pricingKindOfPlan(plan)),
      discountAmount: trialEnd ? listPriceFor(pricingKindOfPlan(plan)) : quote.discountAmount,
      campaignId: trialEnd ? null : quote.campaignId,
      appliedPercent: trialEnd ? null : quote.discountPercent > 0 ? quote.discountPercent : null,
      stripeCouponId: couponId,
      trialApplied: trialEnd !== null,
      requestKey: idempotencyKey ?? null,
      currency: "jpy",
    };
    await prisma.billingTransaction.upsert({
      where: { stripeCheckoutSessionId: session.id },
      create: { ...data, stripeCheckoutSessionId: session.id },
      update: data,
    });

    return NextResponse.json({
      checkoutUrl: session.url,
      plan,
      pricing: quote,
      trial: trialEnd ? { endsAt: trialEnd.toISOString() } : null,
    });
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
