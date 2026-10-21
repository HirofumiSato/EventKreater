import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { appBaseUrl, toErrorResponse } from "@/lib/http";
import { getStripe } from "@/modules/billing/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const quota = await prisma.userUsageQuota.findUnique({ where: { userId } });
    if (!quota) {
      throw new ProblemDetailException({
        status: 404,
        title: "Quota Not Found",
        detail: "主催者の利用枠情報が存在しません。",
      });
    }
    if (!quota.stripeCustomerId) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "Stripe の顧客情報がまだありません。プラン購入後に利用できます。",
        error: "NO_STRIPE_CUSTOMER",
      });
    }

    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: quota.stripeCustomerId,
      return_url: `${appBaseUrl()}/organizer/events`,
    });
    return NextResponse.json({ portalUrl: portalSession.url });
  } catch (error) {
    if (error instanceof Error && error.message === "STRIPE_SECRET_KEY is not set") {
      return toErrorResponse(
        new ProblemDetailException({
          status: 500,
          title: "Internal Server Error",
          detail: "Stripe の秘密鍵が設定されていません。",
        }),
        "/api/v1/billing/portal",
      );
    }
    return toErrorResponse(error, "/api/v1/billing/portal");
  }
}
