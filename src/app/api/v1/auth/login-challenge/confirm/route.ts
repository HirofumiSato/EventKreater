import { NextRequest } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { LoginChallengeConfirmSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import { confirmLoginChallenge, sessionFromChallenge } from "@/modules/auth/lib/login-challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const input = LoginChallengeConfirmSchema.parse(await req.json());
    const result = await confirmLoginChallenge({
      req,
      code: input.code,
      ip: clientIp(req) ?? "local",
    });
    return sessionFromChallenge(req, result.token, result.user, { loginPurpose: result.purpose });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/login-challenge/confirm");
  }
}
