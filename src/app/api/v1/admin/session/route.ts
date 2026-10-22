import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passwordMatches, revokeAuthToken } from "@/modules/auth/lib/auth";
import { requireAdmin } from "@/modules/auth/lib/guards";
import { clearAuthCookies, clientIp, readAuthCookie } from "@/modules/auth/lib/cookies";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { AdminLoginSchema } from "@/lib/schemas";
import {
  assertWithinAttemptLimit,
  attemptWindow,
  clearRuleAttempts,
  limitExtras,
  recordAuthAttempt,
  tighterLimit,
} from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS } from "@/modules/auth/lib/rate-limits";
import { challengeResponse, clearLoginChallengeCookies, startLoginChallenge } from "@/modules/auth/lib/login-challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_FAILURE = "メールアドレスまたはパスワードが正しくありません。";

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    return NextResponse.json({ user: admin });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/admin/session");
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = AdminLoginSchema.parse(await req.json());
    const email = input.email.toLowerCase();
    const ip = clientIp(req) ?? "local";
    const { rules } = AUTH_RATE_LIMITS;
    await assertWithinAttemptLimit(rules.adminLoginEmail, email);
    await assertWithinAttemptLimit(rules.adminLoginIp, ip);
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    const passwordOk = await passwordMatches(input.password, user?.passwordHash ?? null);
    if (!user || !passwordOk || !user.emailVerifiedAt || user.platformRole !== "ADMIN") {
      await recordAuthAttempt(rules.adminLoginEmail, email);
      await recordAuthAttempt(rules.adminLoginIp, ip);
      const tight = tighterLimit([
        [rules.adminLoginEmail, await attemptWindow(rules.adminLoginEmail, email)],
        [rules.adminLoginIp, await attemptWindow(rules.adminLoginIp, ip)],
      ]);
      throw new ProblemDetailException({
        status: 401,
        title: "Unauthorized",
        detail: LOGIN_FAILURE,
        ...(tight ? limitExtras(tight[0], tight[1]) : {}),
      });
    }
    await clearRuleAttempts(rules.adminLoginEmail, email);
    const challenge = await startLoginChallenge({ user, purpose: "ADMIN", ip });
    return challengeResponse(req, challenge.id, challenge.view);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/admin/session");
  }
}

export async function DELETE(req: NextRequest) {
  await revokeAuthToken(readAuthCookie(req));
  const response = NextResponse.json({ success: true });
  clearAuthCookies(response, req);
  clearLoginChallengeCookies(response, req);
  return response;
}
