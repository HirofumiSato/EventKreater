import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { VerifySessionSchema } from "@/lib/schemas";
import { PaymentRejected, fulfillPaidCheckout } from "@/modules/billing/lib/billing";
import { getStripe } from "@/modules/billing/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const body = VerifySessionSchema.parse(await req.json());
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(body.sessionId, { expand: ["line_items"] });
    const updatedQuota = await fulfillPaidCheckout(session, userId);

    return NextResponse.json({
      success: true,
      paymentType: session.metadata?.paymentType ?? (session.mode === "subscription" ? "SUBSCRIPTION" : "ONE_TIME"),
      quota: {
        freeEventCount: updatedQuota.freeEventCount,
        paidCredits: updatedQuota.paidCredits,
        subscriptionStatus: updatedQuota.subscriptionStatus,
        currentPeriodEnd: updatedQuota.currentPeriodEnd
          ? updatedQuota.currentPeriodEnd.toISOString()
          : null,
      },
    });
  } catch (error) {
    if (error instanceof PaymentRejected) {
      return toErrorResponse(
        new ProblemDetailException({
          status: error.reason === "forbidden" ? 403 : 400,
          title: error.reason === "forbidden" ? "Forbidden" : "Validation Error",
          detail:
            error.reason === "forbidden"
              ? "この決済セッションを確認する権限がありません。"
              : "決済が完了していません。",
          error: error.reason === "forbidden" ? "FORBIDDEN_SESSION" : "PAYMENT_NOT_COMPLETED",
        }),
        "/api/v1/billing/checkout/verify",
      );
    }
    if (error instanceof Error && error.message === "STRIPE_SECRET_KEY is not set") {
      return toErrorResponse(
        new ProblemDetailException({
          status: 500,
          title: "Internal Server Error",
          detail: "Stripe の秘密鍵が設定されていません。",
        }),
        "/api/v1/billing/checkout/verify",
      );
    }
    return toErrorResponse(error, "/api/v1/billing/checkout/verify");
  }
}
