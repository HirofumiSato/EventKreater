import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { proposePaletteCandidates } from "@/modules/flyers/lib/flyer";
import { resolveFlyerOwner } from "@/modules/flyers/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** ステップ 4。選んだ配置のまま 4 通りの配色を返す。 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const owner = await resolveFlyerOwner(req);
    const candidates = await proposePaletteCandidates(params.id, owner.ownerTokenHash);
    return NextResponse.json({ candidates });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyers/candidates/${params.id}/palettes`);
  }
}
