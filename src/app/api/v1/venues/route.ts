import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { listVenueSuggestions } from "@/modules/events/lib/venue-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 過去に入力した会場の候補（作成画面の「過去の会場から選ぶ」）。
 * ログイン中は自分のイベントの会場と、この端末で作ったイベントの会場を返す。
 * どちらも無ければ空配列（Cookie も発行しない）。
 */
export async function GET(req: NextRequest) {
  try {
    const venues = await listVenueSuggestions(req);
    return NextResponse.json({ venues });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/venues");
  }
}
