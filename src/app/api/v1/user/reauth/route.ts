import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { AccountReauthSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { requireUserId } from "@/modules/auth/lib/guards";
import { challengeResponse, startAccountChallenge } from "@/modules/auth/lib/login-challenge";
import { ProblemDetailException } from "@/lib/exceptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * マイページの再認証。メール変更・電話番号変更・パスワード変更・退会の前に、
 * 登録済みの電話（SMS）またはメールへ確認番号を送る。
 * 成功してもログインセッションは作らない。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = AccountReauthSchema.parse(await req.json().catch(() => ({})));
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        phoneE164: true,
        phoneVerifiedAt: true,
        platformRole: true,
      },
    });
    if (!user) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "会員が見つかりません。",
      });
    }
    const challenge = await startAccountChallenge({
      user,
      channel: input.channel,
      ip: clientIp(req) ?? "local",
    });
    return challengeResponse(req, challenge.id, challenge.view);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/reauth");
  }
}
