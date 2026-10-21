import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeCookie } from "@/modules/auth/lib/cookies";
import {
  googleAuthConfigured,
  googleAuthorizeUrl,
  resolveAudience,
  safeNextPath,
} from "@/modules/auth/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_MAX_AGE = 60 * 10;

function requestOrigin(req: NextRequest): string {
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const requestedNext = req.nextUrl.searchParams.get("next");
  const nextPath = safeNextPath(requestedNext);
  const audience = resolveAudience(req.nextUrl.searchParams.get("audience"));
  const loginPath = audience === "participant" ? "/participant/login" : "/auth/register";
  const loginUrl = new URL(loginPath, requestOrigin(req));
  if (requestedNext) loginUrl.searchParams.set("next", nextPath);

  if (!googleAuthConfigured()) {
    loginUrl.searchParams.set("error", "google_config");
    return NextResponse.redirect(loginUrl);
  }

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(googleAuthorizeUrl(state, nonce));
  writeCookie(response, req, "google_oauth_state", state, OAUTH_MAX_AGE);
  writeCookie(response, req, "google_oauth_nonce", nonce, OAUTH_MAX_AGE);
  // 明示された戻り先だけを保存する。空なら、確認後の着地はロールで決める。
  writeCookie(response, req, "google_oauth_next", requestedNext ? nextPath : "", OAUTH_MAX_AGE);
  writeCookie(response, req, "google_oauth_audience", audience, OAUTH_MAX_AGE);
  return response;
}
