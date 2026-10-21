import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { proposePaletteCandidates } from "@/modules/flyers/lib/flyer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** ステップ 4。選んだ配置のまま 4 通りの配色を返す。 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const candidates = await proposePaletteCandidates(params.id);
    return NextResponse.json({ candidates });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyers/candidates/${params.id}/palettes`);
  }
}
