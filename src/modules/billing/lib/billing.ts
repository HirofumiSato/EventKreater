import type { Prisma, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException, isUniqueViolation } from "@/lib/exceptions";
import { getStripe, stripeExpectsLive, stripeResourceId } from "@/modules/billing/lib/stripe";
import { ONE_TIME_PRICE_JPY } from "@/modules/billing/lib/plans";
import {
  discountEndsAt,
  listPriceFor,
  pricingKindOfPlan,
  type SubscriptionProduct,
} from "@/modules/billing/lib/pricing";

export async function ensureStripeCustomer(userId: string): Promise<string> {
  const quota = await prisma.userUsageQuota.findUnique({ where: { userId } });
  if (!quota) {
    throw new ProblemDetailException({
      status: 404,
      title: "Quota Not Found",
      detail: "主催者の利用枠情報が存在しません。",
    });
  }
  if (quota.stripeCustomerId) return quota.stripeCustomerId;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "会員が見つかりません。",
    });
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create(
    {
      email: user.email,
      name: user.name,
      metadata: { userId },
    },
    { idempotencyKey: `customer_${userId}` },
  );

  try {
    await prisma.userUsageQuota.update({
      where: { userId },
      data: { stripeCustomerId: customer.id },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const again = await prisma.userUsageQuota.findUnique({ where: { userId } });
    if (again?.stripeCustomerId) return again.stripeCustomerId;
    throw error;
  }
  return customer.id;
}

export async function grantOneTimeCredit(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sessionId: string;
    paymentIntentId: string | null;
    customerId: string | null;
    amount: number;
  },
): Promise<void> {
  const updated = await tx.billingTransaction.updateMany({
    where: {
      stripeCheckoutSessionId: input.sessionId,
      paymentStatus: "PENDING",
    },
    data: {
      paymentStatus: "SUCCEEDED",
      ...(input.paymentIntentId ? { stripePaymentIntentId: input.paymentIntentId } : {}),
    },
  });

  if (updated.count > 0) {
    await tx.userUsageQuota.update({
      where: { userId: input.userId },
      data: { paidCredits: { increment: 1 } },
    });
  } else {
    const existing = await tx.billingTransaction.findUnique({
      where: { stripeCheckoutSessionId: input.sessionId },
    });
    if (!existing) {
      await tx.billingTransaction.create({
        data: {
          userId: input.userId,
          paymentType: "ONE_TIME",
          paymentStatus: "SUCCEEDED",
          amount: input.amount,
          listAmount: input.amount,
          currency: "jpy",
          stripeCheckoutSessionId: input.sessionId,
          stripePaymentIntentId: input.paymentIntentId,
        },
      });
      await tx.userUsageQuota.update({
        where: { userId: input.userId },
        data: { paidCredits: { increment: 1 } },
      });
    }
  }

  if (input.customerId) {
    await tx.userUsageQuota.updateMany({
      where: { userId: input.userId, stripeCustomerId: null },
      data: { stripeCustomerId: input.customerId },
    });
  }
}

export async function activateSubscription(
  tx: Prisma.TransactionClient,
  input: {
    userId?: string | null;
    customerId?: string | null;
    subscriptionId?: string | null;
    periodEnd?: Date | null;
    plan?: SubscriptionProduct | null;
  },
): Promise<void> {
  const data: Prisma.UserUsageQuotaUpdateManyMutationInput = {
    subscriptionStatus: "ACTIVE",
  };
  if (input.subscriptionId) data.stripeSubscriptionId = input.subscriptionId;
  if (input.customerId) data.stripeCustomerId = input.customerId;
  if (input.periodEnd) data.currentPeriodEnd = input.periodEnd;
  if (input.plan) data.subscriptionPlan = input.plan;

  if (input.userId) {
    await tx.userUsageQuota.update({
      where: { userId: input.userId },
      data,
    });
    return;
  }

  const where: Prisma.UserUsageQuotaWhereInput = {
    OR: [
      ...(input.customerId ? [{ stripeCustomerId: input.customerId }] : []),
      ...(input.subscriptionId ? [{ stripeSubscriptionId: input.subscriptionId }] : []),
    ],
  };
  if (!where.OR?.length) return;
  await tx.userUsageQuota.updateMany({ where, data });
}

export async function loadSubscriptionPeriodEnd(subscriptionId: string): Promise<Date | null> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!subscription.current_period_end) return null;
  return new Date(subscription.current_period_end * 1000);
}

/**
 * 退会時のサブスクリプション解約。期間末ではなく即時に止める。
 * すでに解約済みのときは Stripe 側でエラーになるので、状態を確認してから呼ぶ。
 */
export async function cancelSubscriptionForWithdrawal(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.cancel(subscriptionId, { prorate: false });
}

/**
 * 割引（無料期間）の終了日時を利用枠へ記録する。
 * 0円月額の「3日前・1日前」の案内は、この日時だけを見て送る。
 */
async function applyDiscountWindow(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    campaignId: string | null;
    percent: number | null;
    /** 割引が始まる時刻。加入時は決済確定時刻、更新時は今回の請求時刻。 */
    start: Date;
  },
): Promise<void> {
  if (!input.campaignId || !input.percent) return;
  const quota = await tx.userUsageQuota.findUnique({ where: { userId: input.userId } });
  if (!quota) return;
  if (quota.discountEndsAt && quota.discountEndsAt > input.start) return;

  const campaign = await tx.pricingCampaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) return;
  const endsAt = discountEndsAt(input.start, campaign.endsAt);
  if (endsAt <= input.start) return;

  await tx.userUsageQuota.update({
    where: { userId: input.userId },
    data: {
      pricingCampaignId: campaign.id,
      discountPercent: input.percent,
      discountEndsAt: endsAt,
    },
  });
}

async function clearDiscountWindow(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.userUsageQuota.updateMany({
    where: { userId, pricingCampaignId: { not: null } },
    data: { pricingCampaignId: null, discountPercent: null, discountEndsAt: null },
  });
}

export function invoicePeriodEnd(invoice: Stripe.Invoice): Date | null {
  const lineEnd = invoice.lines?.data?.[0]?.period?.end;
  if (typeof lineEnd === "number") return new Date(lineEnd * 1000);
  return null;
}

export class PaymentRejected extends Error {
  constructor(readonly reason: "forbidden" | "invalid") {
    super(reason);
    this.name = "PaymentRejected";
  }
}

function envPrice(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** 新規申込に使う、定額プランの Price ID。 */
export function priceIdForPlan(plan: SubscriptionProduct): string | null {
  return plan === "MONTHLY_8"
    ? envPrice("STRIPE_PRICE_ID_MONTHLY_8")
    : envPrice("STRIPE_PRICE_ID_UNLIMITED");
}

/**
 * 旧・980 円の公開し放題 Price。値上げ前に加入した人は、この Price のまま
 * 回数を数えない契約を続ける。新規の申込には使わない。
 */
export function legacyUnlimitedPriceId(): string | null {
  return envPrice("STRIPE_PRICE_ID_MONTHLY_980_LEGACY") ?? envPrice("STRIPE_PRICE_ID_MONTHLY_980");
}

/** Price ID から、どの定額プランの契約かを引く。知らない Price は null。 */
export function planForPriceId(priceId: string | null | undefined): SubscriptionProduct | null {
  if (!priceId) return null;
  if (priceId === priceIdForPlan("MONTHLY_8")) return "MONTHLY_8";
  if (priceId === priceIdForPlan("UNLIMITED")) return "UNLIMITED";
  if (priceId === legacyUnlimitedPriceId()) return "UNLIMITED";
  return null;
}

/** DB の加入プランから、契約の種類を引く。未設定（NONE）は公開し放題として扱う。 */
export function planOfQuota(plan: SubscriptionPlan): SubscriptionProduct {
  return plan === "MONTHLY_8" ? "MONTHLY_8" : "UNLIMITED";
}

function oneTimePriceId(): string | null {
  return process.env.STRIPE_PRICE_ID_ONE_TIME ?? null;
}

export function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "incomplete":
    case "trialing":
      return "INCOMPLETE";
    default:
      return "CANCELED";
  }
}

async function assertOwnedCustomer(userId: string, customerId: string | null): Promise<void> {
  const quota = await prisma.userUsageQuota.findUnique({ where: { userId } });
  if (!quota) throw new PaymentRejected("invalid");
  if (quota.stripeCustomerId && customerId && quota.stripeCustomerId !== customerId) {
    throw new PaymentRejected("forbidden");
  }
}

export interface PayableCheckout {
  mode: "payment" | "subscription";
  customerId: string | null;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  invoiceId: string | null;
  amount: number;
  /** 月額のときだけ、どの定額プランの契約か。 */
  plan: SubscriptionProduct | null;
  /** 申込時に控えたキャンペーン。会計記録と割引期間の記録に使う。 */
  campaignId: string | null;
  appliedPercent: number | null;
  couponId: string | null;
}

/**
 * Checkout Session が、このアプリが発行したものかを確かめる。
 * 金額は定価ではなく、申込時に billing_transactions へ控えた請求額と突き合わせる。
 * 0円の月額は payment_status が no_payment_required になるので、それも通す。
 */
export async function loadPayableCheckout(
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<PayableCheckout> {
  if (session.livemode !== stripeExpectsLive()) throw new PaymentRejected("invalid");
  if (session.metadata?.userId !== userId) throw new PaymentRejected("forbidden");
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    throw new PaymentRejected("invalid");
  }
  if ((session.currency ?? "").toLowerCase() !== "jpy") throw new PaymentRejected("invalid");

  const customerId = stripeResourceId(session.customer);
  await assertOwnedCustomer(userId, customerId);
  const invoiceId = stripeResourceId(session.invoice);
  let paymentIntentId = stripeResourceId(session.payment_intent);

  const pending = await prisma.billingTransaction.findUnique({
    where: { stripeCheckoutSessionId: session.id },
  });
  // 2023-10-16 の Checkout Session は割引を返さないので、申込時に控えた値を正とする。
  const couponId = pending?.stripeCouponId ?? null;

  if (session.mode === "payment") {
    const expected = pending?.amount ?? ONE_TIME_PRICE_JPY;
    if (session.amount_total == null || session.amount_total !== expected) {
      throw new PaymentRejected("invalid");
    }
    if (expected > 0) {
      const expectedPrice = oneTimePriceId();
      // キャンペーン中は price_data の都度 Price を使うので、静的な Price ID とは一致しない。
      // その場合は申込時に控えた金額だけで確かめる。
      if (expectedPrice && !pending?.campaignId) {
        const priceIds = (session.line_items?.data ?? [])
          .map((item) => item.price?.id)
          .filter((id): id is string => Boolean(id));
        if (!priceIds.includes(expectedPrice)) throw new PaymentRejected("invalid");
      }
    }
    return {
      mode: "payment",
      customerId,
      paymentIntentId,
      subscriptionId: null,
      invoiceId,
      amount: session.amount_total,
      plan: null,
      campaignId: pending?.campaignId ?? session.metadata?.campaignId ?? null,
      appliedPercent: pending?.appliedPercent ?? null,
      couponId,
    };
  }

  if (session.mode !== "subscription") throw new PaymentRejected("invalid");

  const subscriptionId = stripeResourceId(session.subscription);
  if (!subscriptionId) throw new PaymentRejected("invalid");
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const plan = planForPriceId(subscription.items.data[0]?.price?.id);
  if (!plan) throw new PaymentRejected("invalid");

  const expected = pending?.amount ?? listPriceFor(pricingKindOfPlan(plan));
  // 100% クーポンだと初回請求は 0 円で、amount_total が null のことがある。
  const paid = session.amount_total ?? (expected === 0 ? 0 : null);
  if (paid == null || paid !== expected) throw new PaymentRejected("invalid");

  if (!paymentIntentId && invoiceId) {
    const invoice = await getStripe().invoices.retrieve(invoiceId);
    paymentIntentId = stripeResourceId(invoice.payment_intent);
  }

  return {
    mode: "subscription",
    customerId,
    paymentIntentId,
    subscriptionId,
    invoiceId,
    amount: paid,
    plan,
    campaignId: pending?.campaignId ?? session.metadata?.campaignId ?? null,
    appliedPercent: pending?.appliedPercent ?? null,
    couponId: couponId ?? pending?.stripeCouponId ?? null,
  };
}

export async function fulfillPaidCheckout(session: Stripe.Checkout.Session, userId: string) {
  const payable = await loadPayableCheckout(session, userId);
  const periodEnd = payable.subscriptionId ? await loadSubscriptionPeriodEnd(payable.subscriptionId) : null;
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    if (payable.mode === "payment") {
      await grantOneTimeCredit(tx, {
        userId,
        sessionId: session.id,
        paymentIntentId: payable.paymentIntentId,
        customerId: payable.customerId,
        amount: payable.amount,
      });
    } else {
      await activateSubscription(tx, {
        userId,
        customerId: payable.customerId,
        subscriptionId: payable.subscriptionId,
        periodEnd,
        plan: payable.plan,
      });
      const listPrice =
        payable.plan === null ? payable.amount : listPriceFor(pricingKindOfPlan(payable.plan));
      await tx.billingTransaction.updateMany({
        where: {
          stripeCheckoutSessionId: session.id,
          paymentStatus: "PENDING",
        },
        data: {
          paymentStatus: "SUCCEEDED",
          amount: payable.amount,
          listAmount: listPrice,
          discountAmount: Math.max(0, listPrice - payable.amount),
          ...(payable.paymentIntentId ? { stripePaymentIntentId: payable.paymentIntentId } : {}),
          ...(payable.invoiceId ? { stripeInvoiceId: payable.invoiceId } : {}),
        },
      });
      if (payable.campaignId && payable.appliedPercent) {
        await applyDiscountWindow(tx, {
          userId,
          campaignId: payable.campaignId,
          percent: payable.appliedPercent,
          start: now,
        });
      }
    }
    return tx.userUsageQuota.findUniqueOrThrow({ where: { userId } });
  });
}

async function findQuotaByStripe(customerId: string | null, subscriptionId: string | null) {
  if (!customerId && !subscriptionId) return null;
  return prisma.userUsageQuota.findFirst({
    where: {
      OR: [
        ...(customerId ? [{ stripeCustomerId: customerId }] : []),
        ...(subscriptionId ? [{ stripeSubscriptionId: subscriptionId }] : []),
      ],
    },
  });
}

function invoiceCouponId(invoice: Stripe.Invoice): string | null {
  const discount = invoice.discount;
  if (!discount) return null;
  return stripeResourceId(discount.coupon);
}

function invoiceHasDiscount(invoice: Stripe.Invoice): boolean {
  if (invoice.discount) return true;
  return (invoice.total_discount_amounts?.length ?? 0) > 0;
}

/** 請求に付いたクーポンから、どのキャンペーンの割引かを引く。 */
async function campaignFromCoupon(couponId: string | null): Promise<{
  campaignId: string;
  percent: number;
} | null> {
  if (!couponId) return null;
  const mapping = await prisma.pricingCampaignCoupon.findUnique({
    where: { stripeCouponId: couponId },
    include: { campaign: true },
  });
  if (!mapping) return null;
  return { campaignId: mapping.campaignId, percent: mapping.campaign.percent };
}

export async function recordSubscriptionInvoice(
  invoice: Stripe.Invoice,
  status: "SUCCEEDED" | "FAILED",
): Promise<void> {
  if (invoice.livemode !== stripeExpectsLive()) return;
  const customerId = stripeResourceId(invoice.customer);
  const subscriptionId = stripeResourceId(invoice.subscription);
  const quota = await findQuotaByStripe(customerId, subscriptionId);
  if (!quota || !invoice.id) return;

  let plan: SubscriptionProduct | null = null;
  if (status === "SUCCEEDED") {
    if ((invoice.currency ?? "").toLowerCase() !== "jpy") return;
    if (typeof invoice.amount_paid !== "number") return;
    if (!subscriptionId) return;
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    plan = planForPriceId(subscription.items.data[0]?.price?.id);
    if (!plan) return;
    const listPrice = listPriceFor(pricingKindOfPlan(plan));
    if (invoice.amount_paid > listPrice) return;
    // 定価より安い請求は、このアプリが発行したクーポンが付いているときだけ通す。
    if (invoice.amount_paid < listPrice && !invoiceHasDiscount(invoice)) return;
  }

  const amount = status === "SUCCEEDED" ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0);
  const paymentIntentId = stripeResourceId(invoice.payment_intent);
  const periodEnd = invoicePeriodEnd(invoice);
  const couponId = invoiceCouponId(invoice);
  const fromCoupon = status === "SUCCEEDED" ? await campaignFromCoupon(couponId) : null;
  const billingPlan = plan ?? planOfQuota(quota.subscriptionPlan);
  const listPrice = listPriceFor(pricingKindOfPlan(billingPlan));
  const discountAmount = Math.max(0, listPrice - amount);
  const campaignId = fromCoupon?.campaignId ?? quota.pricingCampaignId;
  const appliedPercent =
    fromCoupon?.percent ?? (discountAmount > 0 ? quota.discountPercent : null);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const byInvoice = await tx.billingTransaction.findUnique({ where: { stripeInvoiceId: invoice.id } });
    if (byInvoice) {
      if (byInvoice.paymentStatus === "REFUNDED" || byInvoice.paymentStatus === "DISPUTED") return;
      if (status === "FAILED" && byInvoice.paymentStatus === "SUCCEEDED") return;
      await tx.billingTransaction.update({
        where: { id: byInvoice.id },
        data: {
          paymentStatus: status,
          amount,
          ...(status === "SUCCEEDED"
            ? {
                listAmount: listPrice,
                discountAmount,
                campaignId,
                appliedPercent,
                stripeCouponId: couponId,
              }
            : {}),
          ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
        },
      });
    } else if (status === "SUCCEEDED" && invoice.billing_reason === "subscription_create") {
      const open = await tx.billingTransaction.findFirst({
        where: {
          userId: quota.userId,
          paymentType: "SUBSCRIPTION",
          stripeInvoiceId: null,
          paymentStatus: { in: ["PENDING", "SUCCEEDED"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (open) {
        await tx.billingTransaction.update({
          where: { id: open.id },
          data: {
            paymentStatus: "SUCCEEDED",
            amount,
            listAmount: listPrice,
            discountAmount,
            campaignId: campaignId ?? open.campaignId,
            appliedPercent: appliedPercent ?? open.appliedPercent,
            stripeCouponId: couponId ?? open.stripeCouponId,
            stripeInvoiceId: invoice.id,
            ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
          },
        });
      } else {
        await tx.billingTransaction.create({
          data: {
            userId: quota.userId,
            paymentType: "SUBSCRIPTION",
            paymentStatus: "SUCCEEDED",
            amount,
            listAmount: listPrice,
            discountAmount,
            campaignId,
            appliedPercent,
            stripeCouponId: couponId,
            currency: "jpy",
            stripeInvoiceId: invoice.id,
            stripePaymentIntentId: paymentIntentId,
          },
        });
      }
    } else {
      await tx.billingTransaction.create({
        data: {
          userId: quota.userId,
          paymentType: "SUBSCRIPTION",
          paymentStatus: status,
          amount,
          listAmount: listPrice,
          discountAmount: status === "SUCCEEDED" ? discountAmount : 0,
          campaignId: status === "SUCCEEDED" ? campaignId : null,
          appliedPercent: status === "SUCCEEDED" ? appliedPercent : null,
          stripeCouponId: couponId,
          currency: "jpy",
          stripeInvoiceId: invoice.id,
          stripePaymentIntentId: paymentIntentId,
        },
      });
    }

    if (status === "SUCCEEDED") {
      await activateSubscription(tx, {
        userId: quota.userId,
        customerId,
        subscriptionId,
        periodEnd,
      });
      if (campaignId && appliedPercent) {
        await applyDiscountWindow(tx, {
          userId: quota.userId,
          campaignId,
          percent: appliedPercent,
          start: now,
        });
      } else if (!invoiceHasDiscount(invoice)) {
        // 割引が切れた請求。以後の案内は送らない。
        await clearDiscountWindow(tx, quota.userId);
      }
      return;
    }
    await tx.userUsageQuota.update({
      where: { userId: quota.userId },
      data: { subscriptionStatus: "PAST_DUE" },
    });
  });
}

export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  if (subscription.livemode !== stripeExpectsLive()) return;
  const customerId = stripeResourceId(subscription.customer);
  const quota = await findQuotaByStripe(customerId, subscription.id);
  if (!quota) return;
  const nextStatus = mapStripeSubscriptionStatus(subscription.status);
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = planForPriceId(priceId);
  if (nextStatus === "ACTIVE" && !plan) return;
  await prisma.userUsageQuota.update({
    where: { userId: quota.userId },
    data: {
      subscriptionStatus: nextStatus,
      ...(plan ? { subscriptionPlan: plan } : {}),
      stripeSubscriptionId: subscription.id,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      ...(subscription.current_period_end
        ? { currentPeriodEnd: new Date(subscription.current_period_end * 1000) }
        : {}),
      // 解約済みなら、終了前の案内はもう要らない。
      ...(nextStatus === "CANCELED"
        ? { pricingCampaignId: null, discountPercent: null, discountEndsAt: null }
        : {}),
    },
  });
}

export async function reverseCharge(input: {
  paymentIntentId: string | null;
  invoiceId: string | null;
  nextStatus: "REFUNDED" | "DISPUTED";
  full: boolean;
}): Promise<void> {
  if (!input.full) return;
  if (!input.paymentIntentId && !input.invoiceId) return;
  const existing = await prisma.billingTransaction.findFirst({
    where: {
      OR: [
        ...(input.paymentIntentId ? [{ stripePaymentIntentId: input.paymentIntentId }] : []),
        ...(input.invoiceId ? [{ stripeInvoiceId: input.invoiceId }] : []),
      ],
    },
  });
  if (!existing) return;
  if (existing.paymentStatus === "REFUNDED") return;
  if (existing.paymentStatus === "DISPUTED" && input.nextStatus === "DISPUTED") return;

  const wasPaid = existing.paymentStatus === "SUCCEEDED";
  await prisma.$transaction(async (tx) => {
    await tx.billingTransaction.update({
      where: { id: existing.id },
      data: { paymentStatus: input.nextStatus },
    });
    if (!wasPaid) return;
    if (existing.paymentType === "ONE_TIME") {
      await tx.userUsageQuota.updateMany({
        where: { userId: existing.userId, paidCredits: { gte: 1 } },
        data: { paidCredits: { decrement: 1 } },
      });
      return;
    }
    await tx.userUsageQuota.update({
      where: { userId: existing.userId },
      data: { subscriptionStatus: "CANCELED" },
    });
  });
}
