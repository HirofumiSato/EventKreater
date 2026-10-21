import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { EmailChangeConfirmSchema } from "@/lib/schemas";
import { AUTH_MAX_AGE, authCookieName, writeCookie } from "@/modules/auth/lib/cookies";
import { resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { confirmEmailChange } from "@/modules/account/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 新しいアドレスに届いた確認リンクの確定。
 * リンクは別端末で開くことがあるので、ログインは必須にしない。
 * ログイン中の端末から開いたときは、その端末のセッションを発行し直して継続させる。
 */
export async function POST(req: NextRequest) {
  try {
    const input = EmailChangeConfirmSchema.parse(await req.json());
    const currentUserId = await resolveOptionalUserId(req);
    const result = await confirmEmailChange(input.token);

    const response = NextResponse.json({ success: true, email: result.email });
    if (currentUserId && currentUserId === result.userId) {
      const token = await signLocalToken({ userId: result.userId, email: result.email });
      writeCookie(response, req, authCookieName(req), token, AUTH_MAX_AGE);
    }
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/email/confirm");
  }
}
