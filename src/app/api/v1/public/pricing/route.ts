import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { loadActiveCampaigns } from "@/modules/billing/lib/campaigns";
import { campaignStatus, quoteBoth } from "@/modules/billing/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 料金ページと購入画面が読む、いまの販売価格。ログイン不要。 */
export async function GET() {
  try {
    const now = new Date();
    const campaigns = await loadActiveCampaigns(now);
    const quotes = quoteBoth(campaigns, now);
    return NextResponse.json({
      pricing: quotes,
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        target: campaign.target,
        discountKind: campaign.discountKind,
        percent: campaign.percent,
        endsAt: campaign.endsAt.toISOString(),
        status: campaignStatus(campaign, now),
      })),
      fetchedAt: now.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/public/pricing");
  }
}
