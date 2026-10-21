import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireAdmin } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { PricingCampaignUpdateSchema } from "@/lib/schemas";
import { updateCampaign } from "@/modules/billing/lib/campaigns";
import { serializeCampaign } from "@/modules/billing/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await requireAdmin(req);
    const campaign = await prisma.pricingCampaign.findUnique({
      where: { id: params.id },
      include: {
        audits: { orderBy: { createdAt: "desc" }, take: 50 },
        coupons: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!campaign) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "キャンペーンが見つかりません。",
      });
    }
    return NextResponse.json({
      campaign: serializeCampaign(campaign, new Date()),
      audits: campaign.audits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        before: audit.before,
        after: audit.after,
        createdAt: audit.createdAt.toISOString(),
      })),
      coupons: campaign.coupons.map((coupon) => ({
        id: coupon.id,
        version: coupon.version,
        months: coupon.months,
        kind: coupon.kind,
        stripeCouponId: coupon.stripeCouponId,
        createdAt: coupon.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/admin/pricing-campaigns/${params.id}`);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const admin = await requireAdmin(req);
    const input = PricingCampaignUpdateSchema.parse(await req.json());
    const campaign = await updateCampaign(params.id, input, admin.id);
    return NextResponse.json({ campaign: serializeCampaign(campaign, new Date()) });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/admin/pricing-campaigns/${params.id}`);
  }
}
