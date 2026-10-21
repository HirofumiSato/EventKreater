import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { stopCampaign } from "@/modules/billing/lib/campaigns";
import { serializeCampaign } from "@/modules/billing/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** 新規の申込だけ止める。すでに割引中の購入者は、期間が切れるまでそのまま。 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const admin = await requireAdmin(req);
    const campaign = await stopCampaign(params.id, admin.id);
    return NextResponse.json({ campaign: serializeCampaign(campaign, new Date()) });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/admin/pricing-campaigns/${params.id}/stop`);
  }
}
