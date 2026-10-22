import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordMatches } from "@/modules/auth/lib/auth";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { AuthSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { challengeResponse, purposeForAudience, startLoginChallenge } from "@/modules/auth/lib/login-challenge";
import { assertPasswordNotBreached } from "@/modules/auth/lib/pwned";
import {
  assertWithinAttemptLimit,
  attemptWindow,
  clearRuleAttempts,
  limitExtras,
  recordAuthAttempt,
  tighterLimit,
} from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS } from "@/modules/auth/lib/rate-limits";
import {
  VERIFICATION_NOTICE,
  beginSignupIntent,
  sendAlreadyRegisteredEmail,
  sendIntentVerification,
  sendVerificationEmail,
} from "@/modules/auth/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_FAILURE = "メールアドレスまたはパスワードが正しくありません。";

function attemptIp(req: NextRequest): string {
  return clientIp(req) ?? "local";
}

/**
 * パスワード不一致の応答。メールの有無は明かさず、厳しいほうの上限だけを添える。
 * 回数は画面に出す必要があるため、失敗のたびに残りを返す。
 */
async function loginFailure(email: string, ip: string): Promise<ProblemDetailException> {
  const { rules } = AUTH_RATE_LIMITS;
  const tight = tighterLimit([
    [rules.loginEmail, await attemptWindow(rules.loginEmail, email)],
    [rules.loginIp, await attemptWindow(rules.loginIp, ip)],
  ]);
  return new ProblemDetailException({
    status: 401,
    title: "Unauthorized",
    detail: LOGIN_FAILURE,
    ...(tight ? limitExtras(tight[0], tight[1]) : {}),
  });
}

export async function POST(req: NextRequest) {
  try {
    const input = AuthSchema.parse(await req.json());
    const email = input.email.toLowerCase();
    const ip = attemptIp(req);

    if (input.action === "register") {
      await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.registerIp, ip);
      await recordAuthAttempt(AUTH_RATE_LIMITS.rules.registerIp, ip);
      await assertPasswordNotBreached(input.password);

      const existing = await prisma.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, email: true, name: true, emailVerifiedAt: true, passwordHash: true },
      });
      if (existing?.emailVerifiedAt && existing.passwordHash) {
        await sendAlreadyRegisteredEmail(existing.email);
        return NextResponse.json({ verificationRequired: true, detail: VERIFICATION_NOTICE });
      }
      if (existing && !existing.emailVerifiedAt) {
        await sendVerificationEmail(existing);
        return NextResponse.json({ verificationRequired: true, detail: VERIFICATION_NOTICE });
      }

      const intent = await beginSignupIntent({
        email,
        name: existing?.name || input.name,
        passwordHash: await hashPassword(input.password),
        audience: input.audience === "participant" ? "PARTICIPANT" : "ORGANIZER",
      });
      await sendIntentVerification(intent);
      return NextResponse.json({ verificationRequired: true, detail: VERIFICATION_NOTICE });
    }

    const { rules } = AUTH_RATE_LIMITS;
    await assertWithinAttemptLimit(rules.loginEmail, email);
    await assertWithinAttemptLimit(rules.loginIp, ip);
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    const passwordOk = await passwordMatches(input.password, user?.passwordHash ?? null);
    if (!user || !passwordOk) {
      await recordAuthAttempt(rules.loginEmail, email);
      await recordAuthAttempt(rules.loginIp, ip);
      throw await loginFailure(email, ip);
    }
    // パスワードが合ったら、メール単位の失敗は数え直す。
    // IP 単位は、同じ回線を使う別の利用者の失敗を 1 人の成功で帳消しにしないため残す。
    await clearRuleAttempts(rules.loginEmail, email);
    if (!user.emailVerifiedAt) {
      throw new ProblemDetailException({
        status: 403,
        title: "Forbidden",
        detail: "メールアドレスの確認が完了していません。確認メールのリンクを開いてください。",
        error: "EMAIL_UNVERIFIED",
      });
    }

    const challenge = await startLoginChallenge({
      user,
      purpose: purposeForAudience(input.audience),
      ip,
    });
    return challengeResponse(req, challenge.id, challenge.view);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/local");
  }
}
