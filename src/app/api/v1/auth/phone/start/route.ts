import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/http";
import { SIGNUP_INTENT_COOKIE, clientIp } from "@/modules/auth/lib/cookies";
import { resolveUserId } from "@/modules/auth/lib/guards";
import { startPhoneVerification } from "@/modules/auth/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  phone: z.string().trim().min(8).max(20),
});

export async function POST(req: NextRequest) {
  try {
    const input = BodySchema.parse(await req.json());
    const userId = await resolveUserId(req);
    const intentId = userId ? null : (req.cookies.get(SIGNUP_INTENT_COOKIE)?.value ?? null);
    const result = await startPhoneVerification({
      phoneRaw: input.phone,
      userId,
      intentId,
      ip: clientIp(req) ?? "local",
    });
    if (result.alreadyVerified) {
      return NextResponse.json({ alreadyVerified: true });
    }
    return NextResponse.json({
      sent: true,
      detail: "確認コードを送信しました。届かない場合は、しばらくしてから再度お試しください。",
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/phone/start");
  }
}
