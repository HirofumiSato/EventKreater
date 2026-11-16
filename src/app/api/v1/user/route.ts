import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { WithdrawSchema } from "@/lib/schemas";
import { clientIp, clearAuthCookies } from "@/modules/auth/lib/cookies";
import { clearLoginChallengeCookies } from "@/modules/auth/lib/login-challenge";
import { requireUserId } from "@/modules/auth/lib/guards";
import { cancelSubscriptionForWithdrawal } from "@/modules/billing/lib/billing";
import { requestIpHash, withdrawAccount } from "@/modules/account/lib/account";
import { verifyPasswordOrCode } from "@/modules/account/lib/reauth";
import { revalidatePublicEvent } from "@/modules/events/lib/public-event";
import { revalidateOrganizerPagesOfEvent } from "@/modules/organizers/lib/public-organizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 退会（論理削除）。
 * 筆頭幹事のイベントは閉じ、確認済みの電話番号だけは再登録の突き合わせのために残す。
 * サブスクリプションは即時解約し、失敗したら退会を中止する。
 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = WithdrawSchema.parse(await req.json());
    const ip = clientIp(req) ?? "local";
    await verifyPasswordOrCode({
      req,
      userId,
      password: input.password,
      code: input.code,
      ip,
    });
    const affectedEventIds = await withdrawAccount({
      userId,
      ipHash: requestIpHash(req),
      cancelSubscription: cancelSubscriptionForWithdrawal,
    });
    // 閉じたイベントは 404 に、外れた共同主催は一覧から消える。古い本文を返さない。
    for (const eventId of affectedEventIds) {
      revalidatePublicEvent(eventId);
      // 共同主催の公開ページからも、閉じた催しが消える。
      await revalidateOrganizerPagesOfEvent(eventId);
    }
    const response = NextResponse.json({ success: true });
    clearAuthCookies(response, req);
    clearLoginChallengeCookies(response, req);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user");
  }
}
