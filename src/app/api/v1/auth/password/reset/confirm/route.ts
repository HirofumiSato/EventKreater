import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { PasswordResetConfirmSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { confirmPasswordReset } from "@/modules/auth/lib/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const input = PasswordResetConfirmSchema.parse(await req.json());
    await confirmPasswordReset({
      token: input.token,
      newPassword: input.newPassword,
      ip: clientIp(req) ?? "local",
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/password/reset/confirm");
  }
}
