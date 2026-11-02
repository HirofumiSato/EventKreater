import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl, toErrorResponse } from "@/lib/http";
import { requireUserId } from "@/modules/auth/lib/guards";
import { REFERRAL_TICKET_LIMIT } from "@/modules/billing/lib/tickets";
import { ensureReferralCode } from "@/modules/billing/lib/referral";
import { referralUrl } from "@/modules/billing/lib/referral-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 自分の紹介リンクと実績。
 *
 * `code` は初めて開いたときに作る（既存の会員をまとめて埋めない）。
 * `invited` は紹介リンクから登録した人数、`granted` は受け取ったチケットの枚数。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const [code, invited, granted] = await Promise.all([
      ensureReferralCode(userId),
      prisma.user.count({ where: { referredByUserId: userId, deletedAt: null } }),
      prisma.freeTicket.count({ where: { userId, source: "REFERRAL" } }),
    ]);

    return NextResponse.json({
      code,
      url: referralUrl(appBaseUrl(), code),
      invited,
      granted,
      limit: REFERRAL_TICKET_LIMIT,
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/referral");
  }
}
