import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordMatches } from "@/modules/auth/lib/auth";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { AuthSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { challengeResponse, purposeForAudience, startLoginChallenge } from "@/modules/auth/lib/login-challenge";
import { assertPasswordNotBreached } from "@/modules/auth/lib/pwned";
import { assertWithinAttemptLimit, recordAuthAttempt } from "@/modules/auth/lib/rate-limit";
import {
  VERIFICATION_NOTICE,
  beginSignupIntent,
  sendAlreadyRegisteredEmail,
  sendIntentVerification,
  sendVerificationEmail,
} from "@/modules/auth/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_FAILURE = "メールアドレスまたはパスワードが正しくありません。";

function attemptIp(req: NextRequest): string {
  return clientIp(req) ?? "local";
}

export async function POST(req: NextRequest) {
  try {
    const input = AuthSchema.parse(await req.json());
    const email = input.email.toLowerCase();
    const ip = attemptIp(req);

    if (input.action === "register") {
      await assertWithinAttemptLimit(`register:ip:${ip}`, 5, REGISTER_WINDOW_MS);
      await recordAuthAttempt(`register:ip:${ip}`);
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

    await assertWithinAttemptLimit(`login:email:${email}`, 5, LOGIN_WINDOW_MS);
    await assertWithinAttemptLimit(`login:ip:${ip}`, 20, LOGIN_WINDOW_MS);
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    const passwordOk = await passwordMatches(input.password, user?.passwordHash ?? null);
    if (!user || !passwordOk) {
      await recordAuthAttempt(`login:email:${email}`);
      await recordAuthAttempt(`login:ip:${ip}`);
      throw new ProblemDetailException({
        status: 401,
        title: "Unauthorized",
        detail: LOGIN_FAILURE,
      });
    }
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
