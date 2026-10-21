import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { LoginChallengeDeliverSchema } from "@/lib/schemas";
import { clientIp } from "@/modules/auth/lib/cookies";
import {
  challengeResponse,
  currentLoginChallenge,
  switchLoginChallengeChannel,
} from "@/modules/auth/lib/login-challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await currentLoginChallenge(req));
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/login-challenge");
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = LoginChallengeDeliverSchema.parse(await req.json());
    const switched = await switchLoginChallengeChannel({
      req,
      channel: input.channel,
      ip: clientIp(req) ?? "local",
    });
    return challengeResponse(req, switched.id, switched.view);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/auth/login-challenge");
  }
}
