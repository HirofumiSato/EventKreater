import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException, isUniqueViolation } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { appBaseUrl, toErrorResponse } from "@/lib/http";
import { ONE_TIME_PRICE_JPY } from "@/modules/billing/lib/plans";
import { ensureStripeCustomer } from "@/modules/billing/lib/billing";
import { getStripe, checkoutIdempotencyKey } from "@/modules/billing/lib/stripe";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { quoteFor, type PricingQuote } from "@/modules/billing/lib/pricing";
import { CheckoutIntentSchema } from "@/lib/schemas";
import {
  DEFAULT_CHECKOUT_RETURN_TO,
  assertOwnDraft,
  checkoutReturnUrls,
} from "@/modules/billing/lib/checkout-intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function phoneRequired(): ProblemDetailException {
  return new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    detail: "0円のチケットを受け取るには電話番号の確認が必要です。会員登録で確認してください。",
    error: "PHONE_REQUIRED",
  });
}

async function grantFreeTicket(userId: string, quote: PricingQuote, requestKey: string | undefined) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phoneVerifiedAt: true },
  });
  if (!user?.phoneVerifiedAt) throw phoneRequired();
  if (!quote.campaignId) {
    throw new ProblemDetailException({
      status: 409,
      title: "Conflict",
      detail: "0円キャンペーンは終了しました。もう一度お試しください。",
      error: "CAMPAIGN_ENDED",
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // 同じ人が同時に2回押しても、付与は1回だけにする。
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const campaign = await tx.pricingCampaign.findUnique({
        where: { id: quote.campaignId as string },
      });
      if (!campaign) {
        throw new ProblemDetailException({
          status: 409,
          title: "Conflict",
          detail: "0円キャンペーンは終了しました。もう一度お試しください。",
          error: "CAMPAIGN_ENDED",
        });
      }

      const used = await tx.billingTransaction.count({
        where: {
          userId,
          campaignId: campaign.id,
          paymentType: "ONE_TIME",
          paymentStatus: "SUCCEEDED",
          amount: 0,
        },
      });
      if (used >= campaign.freePerUserLimit) {
        const quota = await tx.userUsageQuota.findUniqueOrThrow({ where: { userId } });
        return { granted: false, limited: true, quota, pricing: quote };
      }

      await tx.billingTransaction.create({
        data: {
          userId,
          paymentType: "ONE_TIME",
          paymentStatus: "SUCCEEDED",
          amount: 0,
          listAmount: ONE_TIME_PRICE_JPY,
          discountAmount: ONE_TIME_PRICE_JPY,
          campaignId: campaign.id,
          appliedPercent: 100,
          requestKey,
          currency: "jpy",
        },
      });
      const quota = await tx.userUsageQuota.update({
        where: { userId },
        data: { paidCredits: { increment: 1 } },
      });
      return { granted: true, limited: false, quota, pricing: quote };
    });
  } catch (error) {
    // 同じ Idempotency-Key の二重送信。すでに付与済みとして現在の枠を返す。
    if (isUniqueViolation(error)) {
      const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId } });
      return { granted: true, limited: false, quota, pricing: quote };
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const now = new Date();
    const quote = quoteFor("ONE_TIME", await loadActiveCampaigns(now), now);
    const requestKey = checkoutIdempotencyKey(req, userId, "free_ticket");

    // 枠が無いときに作った下書きを、購入後に復元するための手がかり。
    const intent = CheckoutIntentSchema.parse(await req.json().catch(() => ({})));
    const returnTo = intent.returnTo ?? DEFAULT_CHECKOUT_RETURN_TO;

    if (quote.chargedPrice === 0) {
      const result = await grantFreeTicket(userId, quote, requestKey);
      return NextResponse.json(result);
    }

    if (intent.draftId) await assertOwnDraft(userId, intent.draftId);

    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(userId);
    const appUrl = appBaseUrl();
    const priceId = process.env.STRIPE_PRICE_ID_ONE_TIME;
    const idempotencyKey = checkoutIdempotencyKey(req, userId, "one_time");
    const { successUrl, cancelUrl } = checkoutReturnUrls(appUrl, returnTo, intent.draftId);

    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ["card"],
        customer: customerId,
        line_items: [
          // 割引中は定価の Price ではなく、その場の請求額を使う。
          priceId && !quote.campaignId
            ? { price: priceId, quantity: 1 }
            : {
                price_data: {
                  currency: "jpy",
                  product_data: {
                    name: "イベント紹介ページ生成 単発チケット",
                    description: "イベント紹介ページを1回生成・公開できます。",
                  },
                  unit_amount: quote.chargedPrice,
                },
                quantity: 1,
              },
        ],
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        metadata: {
          userId,
          paymentType: "ONE_TIME",
          ...(intent.draftId ? { draftId: intent.draftId } : {}),
          ...(intent.returnTo ? { returnTo } : {}),
          ...(quote.campaignId
            ? { campaignId: quote.campaignId, appliedPercent: String(quote.discountPercent) }
            : {}),
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
      paymentType: "ONE_TIME" as const,
      paymentStatus: "PENDING" as const,
      amount: quote.chargedPrice,
      listAmount: quote.listPrice,
      discountAmount: quote.discountAmount,
      campaignId: quote.campaignId,
      appliedPercent: quote.discountPercent > 0 ? quote.discountPercent : null,
      requestKey,
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
        "/api/v1/billing/checkout/one-time",
      );
    }
    return toErrorResponse(error, "/api/v1/billing/checkout/one-time");
  }
}
