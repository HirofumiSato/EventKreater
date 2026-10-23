import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { deleteVenueSuggestion } from "@/modules/events/lib/venue-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 会場の候補を削除する。自分の候補だけを消し、他人の候補は 404 にする
 * （存在を推測させないため、権限が無い場合と見つからない場合を区別しない）。
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    if (!UUID_PATTERN.test(params.id)) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "会場の候補が見つかりません。",
      });
    }
    const deleted = await deleteVenueSuggestion(req, params.id);
    if (!deleted) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "会場の候補が見つかりません。",
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/venues/${params.id}`);
  }
}
