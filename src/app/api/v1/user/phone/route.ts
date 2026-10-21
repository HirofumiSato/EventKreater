import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { PhoneChangeStartSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { requireUserId } from "@/modules/auth/lib/guards";
import { maskPhone } from "@/modules/auth/lib/login-challenge";
import { startPhoneChangeVerification, assertPhoneChangeable } from "@/modules/auth/lib/phone";
import { verifyPasswordOrCode } from "@/modules/account/lib/reauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 電話番号変更の第1段階。
 * 現在のパスワード（Google のみの会員は確認番号）で本人確認してから、新しい番号へ SMS を送る。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = PhoneChangeStartSchema.parse(await req.json());
    const ip = clientIp(req) ?? "local";
    // 変更先が使えない番号なら、確認番号を消費する前に止める。
    await assertPhoneChangeable(userId, input.phone);
    await verifyPasswordOrCode({ req, userId, password: input.password, code: input.code, ip });
    const result = await startPhoneChangeVerification({
      userId,
      phoneRaw: input.phone,
      ip,
    });
    return NextResponse.json({
      sent: true,
      maskedPhone: maskPhone(result.phoneE164),
      detail: "新しい電話番号へ確認コードを送信しました。",
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/phone");
  }
}
