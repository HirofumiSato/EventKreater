import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { PricingCampaignSchema } from "@/lib/schemas";
import { createCampaign, listCampaigns } from "@/modules/billing/lib/campaigns";
import { serializeCampaign } from "@/modules/billing/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const now = new Date();
    const [campaigns, groups] = await Promise.all([
      listCampaigns(),
      prisma.billingTransaction.groupBy({
        by: ["campaignId", "paymentStatus"],
        where: { campaignId: { not: null } },
        _count: { _all: true },
        _sum: { amount: true, discountAmount: true },
      }),
    ]);

    const stats = new Map<string, { paidCount: number; revenue: number; discountTotal: number }>();
    for (const group of groups) {
      if (!group.campaignId) continue;
      const current = stats.get(group.campaignId) ?? {
        paidCount: 0,
        revenue: 0,
        discountTotal: 0,
      };
      if (group.paymentStatus === "SUCCEEDED") {
        current.paidCount += group._count._all;
        current.revenue += group._sum.amount ?? 0;
        current.discountTotal += group._sum.discountAmount ?? 0;
      }
      stats.set(group.campaignId, current);
    }

    return NextResponse.json({
      campaigns: campaigns.map((campaign) => ({
        ...serializeCampaign(campaign, now),
        stats: stats.get(campaign.id) ?? { paidCount: 0, revenue: 0, discountTotal: 0 },
      })),
      fetchedAt: now.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/admin/pricing-campaigns");
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const input = PricingCampaignSchema.parse(await req.json());
    const campaign = await createCampaign(input, admin.id);
    return NextResponse.json({ campaign: serializeCampaign(campaign, new Date()) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/admin/pricing-campaigns");
  }
}
