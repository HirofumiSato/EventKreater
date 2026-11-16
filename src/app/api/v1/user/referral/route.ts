import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { requireUserId } from "@/modules/auth/lib/guards";
import { loadReferralSummary } from "@/modules/billing/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 自分の紹介リンクと実績。
 *
 * 数え上げは `loadReferralSummary` が持つ。マイページの初期値と同じ 1 本を読む。
 * `code` は初めて開いたときに作る（既存の会員をまとめて埋めない）。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const summary = await loadReferralSummary(userId);
    return NextResponse.json(summary);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/referral");
  }
}
