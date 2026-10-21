import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { EmailChangeStartSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { requireUserId } from "@/modules/auth/lib/guards";
import { requestIpHash, assertEmailChangeable, startEmailChange } from "@/modules/account/lib/account";
import { verifyReauthCode } from "@/modules/account/lib/reauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * メールアドレス変更の第2段階。
 * 先に POST /api/v1/user/reauth で現在の連絡先へ確認番号を送り、その番号をここで検証する。
 * 検証できたら、新しいアドレスへ確認リンクを送る（まだ users.email は変えない）。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = EmailChangeStartSchema.parse(await req.json());
    const ip = clientIp(req) ?? "local";
    // 変更先が使えないアドレスなら、確認番号を消費する前に止める。
    await assertEmailChangeable(userId, input.newEmail);
    await verifyReauthCode({ req, code: input.code, ip });
    const pending = await startEmailChange({
      userId,
      newEmail: input.newEmail,
      ipHash: requestIpHash(req),
    });
    return NextResponse.json({
      sent: true,
      maskedEmail: pending.maskedEmail,
      expiresAt: pending.expiresAt,
      detail: "新しいメールアドレスへ確認リンクを送りました。リンクを開くと変更が完了します。",
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/email");
  }
}
