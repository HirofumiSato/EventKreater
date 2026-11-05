import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { PasswordResetRequestSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { requestPasswordReset } from "@/modules/auth/lib/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const input = PasswordResetRequestSchema.parse(await req.json());
    // 会員の有無・退会・管理者で応答を変えない。メールを送るかどうかだけが内部の差。
    const result = await requestPasswordReset({
      email: input.email,
      audience: input.audience ?? "organizer",
      ip: clientIp(req) ?? "local",
    });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/password/reset");
  }
}
