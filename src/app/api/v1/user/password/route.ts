import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { PasswordChangeSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { requireUserId, readAuthToken } from "@/modules/auth/lib/guards";
import { readTokenSessionId } from "@/modules/auth/lib/auth";
import { changePassword, requestIpHash, revokeOtherSessions } from "@/modules/account/lib/account";
import { verifyPasswordOrCode } from "@/modules/account/lib/reauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * パスワードの変更。現在のパスワード（Google のみの会員は確認番号）で本人確認する。
 * 変更後は、いま使っている端末以外のログインを切る。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = PasswordChangeSchema.parse(await req.json());
    const ip = clientIp(req) ?? "local";
    await verifyPasswordOrCode({
      req,
      userId,
      password: input.currentPassword,
      code: input.code,
      ip,
    });
    await changePassword({ userId, newPassword: input.newPassword, ipHash: requestIpHash(req) });

    const token = readAuthToken(req);
    const sessionId = token ? await readTokenSessionId(token) : null;
    await revokeOtherSessions(userId, sessionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/password");
  }
}
