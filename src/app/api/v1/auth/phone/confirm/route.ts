import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/http";
import { signLocalToken } from "@/modules/auth/lib/auth";
import {
  AUTH_MAX_AGE,
  SIGNUP_INTENT_COOKIE,
  authCookieName,
  clearCookie,
  clientIp,
  writeCookie,
} from "@/modules/auth/lib/cookies";
import { clearLoginChallengeCookies } from "@/modules/auth/lib/login-challenge";
import { resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { confirmPhoneVerification } from "@/modules/auth/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  phone: z.string().trim().min(8).max(20),
  code: z.string().trim().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  try {
    const input = BodySchema.parse(await req.json());
    // 失効した Cookie は未ログイン扱い。登録意向（signup_intent）で続けられる。
    const userId = await resolveOptionalUserId(req);
    const intentId = userId ? null : (req.cookies.get(SIGNUP_INTENT_COOKIE)?.value ?? null);
    const result = await confirmPhoneVerification({
      phoneRaw: input.phone,
      code: input.code,
      userId,
      intentId,
      ip: clientIp(req) ?? "local",
    });
    const token = await signLocalToken({ userId: result.user.id, email: result.user.email });
    const response = NextResponse.json({
      user: result.user,
      phoneVerified: true,
      attachedExisting: result.attachedExisting,
      // 退会済みの行を引き継いだときは true。画面で「以前のアカウントを引き継ぎました」と出す。
      reactivated: result.reactivated,
    });
    writeCookie(response, req, authCookieName(req), token, AUTH_MAX_AGE);
    clearCookie(response, req, SIGNUP_INTENT_COOKIE);
    clearLoginChallengeCookies(response, req);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/phone/confirm");
  }
}
