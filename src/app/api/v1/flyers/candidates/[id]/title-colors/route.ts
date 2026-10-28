import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { proposeTitleColorCandidates } from "@/modules/flyers/lib/flyer";
import { resolveFlyerOwner } from "@/modules/flyers/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** ステップ 5。選んだ配色のまま 4 通りのタイトル色を返す。 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const owner = await resolveFlyerOwner(req);
    const candidates = await proposeTitleColorCandidates(params.id, owner.ownerTokenHash);
    return NextResponse.json({ candidates });
  } catch (error) {
    return toErrorResponse(
      error,
      `/api/v1/flyers/candidates/${params.id}/title-colors`,
    );
  }
}
