import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/exceptions";
import {
  PaymentRejected,
  fulfillPaidCheckout,
  recordSubscriptionInvoice,
  reverseCharge,
  syncSubscription,
} from "@/modules/billing/lib/billing";
import { getStripe, stripeResourceId } from "@/modules/billing/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function applyEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId) return;
      const full = await getStripe().checkout.sessions.retrieve(session.id, { expand: ["line_items"] });
      await fulfillPaidCheckout(full, userId);
      return;
    }
    case "invoice.payment_succeeded": {
      await recordSubscriptionInvoice(event.data.object as Stripe.Invoice, "SUCCEEDED");
      return;
    }
    case "invoice.payment_failed": {
      await recordSubscriptionInvoice(event.data.object as Stripe.Invoice, "FAILED");
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      return;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await reverseCharge({
        paymentIntentId: stripeResourceId(charge.payment_intent),
        invoiceId: stripeResourceId(charge.invoice),
        nextStatus: "REFUNDED",
        full: charge.refunded === true,
      });
      return;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      await reverseCharge({
        paymentIntentId: stripeResourceId(dispute.payment_intent),
        invoiceId: null,
        nextStatus: "DISPUTED",
        full: true,
      });
      return;
    }
    default:
      return;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "MISSING_SIGNATURE" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid signature";
    console.error(`Webhook signature verification failed: ${message}`);
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  try {
    const recorded = await prisma.$transaction(async (tx) => {
      const existing = await tx.stripeWebhookEvent.findUnique({
        where: { stripeEventId: event.id },
      });
      if (existing) return false;
      await tx.stripeWebhookEvent.create({
        data: { stripeEventId: event.id, eventType: event.type },
      });
      return true;
    });

    if (!recorded) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }

    try {
      await applyEvent(event);
    } catch (processingError) {
      if (processingError instanceof PaymentRejected) {
        console.error(`Webhook payment rejected: ${event.id} ${processingError.reason}`);
        return NextResponse.json({ received: true, ignored: true }, { status: 200 });
      }
      await prisma.stripeWebhookEvent.deleteMany({ where: { stripeEventId: event.id } });
      throw processingError;
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`Database error during webhook processing: ${message}`);
    return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
  }
}
