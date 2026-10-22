import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { clientIp } from "@/modules/auth/lib/cookies";
import { assertWithinAttemptLimit, recordAuthAttempt } from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS } from "@/modules/auth/lib/rate-limits";
import { VERIFICATION_NOTICE, sendIntentVerification, sendVerificationEmail } from "@/modules/auth/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().trim().email().max(255),
});

export async function POST(req: NextRequest) {
  try {
    const input = BodySchema.parse(await req.json());
    const email = input.email.toLowerCase();
    const ip = clientIp(req) ?? "local";
    await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.verifyEmail, email);
    await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.verifyIp, ip);
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.verifyEmail, email);
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.verifyIp, ip);

    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, email: true, name: true, emailVerifiedAt: true, passwordHash: true },
    });
    if (user?.passwordHash && !user.emailVerifiedAt) {
      await sendVerificationEmail(user);
    } else {
      const intent = await prisma.signupIntent.findFirst({
        where: { email, emailVerifiedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, name: true, audience: true },
      });
      if (intent) await sendIntentVerification(intent);
    }
    return NextResponse.json({ verificationRequired: true, detail: VERIFICATION_NOTICE });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/verification");
  }
}
