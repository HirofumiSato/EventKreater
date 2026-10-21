import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { PhoneChangeConfirmSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { requireUserId, readAuthToken } from "@/modules/auth/lib/guards";
import { readTokenSessionId } from "@/modules/auth/lib/auth";
import { maskPhone } from "@/modules/auth/lib/login-challenge";
import { confirmPhoneChangeVerification } from "@/modules/auth/lib/phone";
import { requestIpHash, revokeOtherSessions } from "@/modules/account/lib/account";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 電話番号変更の確定。新しい番号へ届いた確認コードを照合する。
 * 済んだら、いま使っている端末以外のログインを切る。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = PhoneChangeConfirmSchema.parse(await req.json());
    const ip = clientIp(req) ?? "local";
    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { phoneE164: true },
    });
    const user = await confirmPhoneChangeVerification({
      userId,
      phoneRaw: input.phone,
      code: input.code,
      ip,
    });
    await prisma.accountChangeLog.create({
      data: {
        userId,
        kind: "PHONE",
        beforeValue: before?.phoneE164 ? maskPhone(before.phoneE164) : null,
        afterValue: maskPhone(user.phoneE164),
        ipHash: requestIpHash(req),
      },
    });
    const token = readAuthToken(req);
    const sessionId = token ? await readTokenSessionId(token) : null;
    await revokeOtherSessions(userId, sessionId);
    return NextResponse.json({
      success: true,
      phoneMasked: maskPhone(user.phoneE164),
      phoneVerified: true,
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/phone/confirm");
  }
}
