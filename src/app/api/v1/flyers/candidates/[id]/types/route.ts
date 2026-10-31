import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { proposeTypeCandidates } from "@/modules/flyers/lib/flyer";
import { resolveFlyerOwner } from "@/modules/flyers/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** ステップ 2。選んだ背景の上で、3 種の紙面の性格を焼き直す。 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const owner = await resolveFlyerOwner(req);
    const candidates = await proposeTypeCandidates(params.id, owner.ownerTokenHash);
    return NextResponse.json({ candidates });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyers/candidates/${params.id}/types`);
  }
}
