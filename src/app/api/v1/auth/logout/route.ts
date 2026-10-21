import { NextRequest, NextResponse } from "next/server";
import { revokeAuthToken } from "@/modules/auth/lib/auth";
import { clearAuthCookies, readAuthCookie } from "@/modules/auth/lib/cookies";
import { clearLoginChallengeCookies } from "@/modules/auth/lib/login-challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await revokeAuthToken(readAuthCookie(req));
  const response = NextResponse.json({ success: true });
  clearAuthCookies(response, req);
  clearLoginChallengeCookies(response, req);
  return response;
}
