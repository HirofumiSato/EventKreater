import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { SIGNUP_INTENT_COOKIE, SIGNUP_INTENT_MAX_AGE, clientIp, writeCookie } from "@/modules/auth/lib/cookies";
import { assertWithinAttemptLimit, recordAuthAttempt } from "@/modules/auth/lib/rate-limit";
import { confirmEmailToken } from "@/modules/auth/lib/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const input = BodySchema.parse(await req.json());
    const ip = clientIp(req) ?? "local";
    await assertWithinAttemptLimit(`verify-token:ip:${ip}`, 10, 60 * 60 * 1000);
    await recordAuthAttempt(`verify-token:ip:${ip}`);
    const confirmed = await confirmEmailToken(input.token);
    if (!confirmed.ok) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "確認リンクが無効か、期限が切れています。登録画面から確認メールを再送してください。",
      });
    }
    const response = NextResponse.json({ verified: true, next: confirmed.next });
    if (confirmed.next === "phone") {
      writeCookie(response, req, SIGNUP_INTENT_COOKIE, confirmed.intentId, SIGNUP_INTENT_MAX_AGE);
    }
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/verify");
  }
}
