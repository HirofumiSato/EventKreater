import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { proposeLayoutCandidates } from "@/modules/flyers/lib/flyer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** ステップ 3。同じ背景で 4 通りの文字配置を返す。 */
export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const candidates = await proposeLayoutCandidates(params.id);
    return NextResponse.json({ candidates });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyers/candidates/${params.id}/layouts`);
  }
}
