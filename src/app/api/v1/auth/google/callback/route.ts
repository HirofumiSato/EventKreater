import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  SIGNUP_INTENT_COOKIE,
  SIGNUP_INTENT_MAX_AGE,
  clearCookie,
  clientIp,
  writeCookie,
} from "@/modules/auth/lib/cookies";
import { startLoginChallenge, purposeForAudience, writeLoginChallengeCookie } from "@/modules/auth/lib/login-challenge";
import {
  GoogleAuthError,
  exchangeGoogleCode,
  resolveAudience,
  resolveGoogleAccount,
  safeNextPath,
  verifyGoogleIdToken,
} from "@/modules/auth/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rawNext = req.cookies.get("google_oauth_next")?.value ?? "";
  const hasExplicitNext = rawNext.length > 0;
  const nextPath = safeNextPath(rawNext);
  const audience = resolveAudience(req.cookies.get("google_oauth_audience")?.value);
  const basePath = audience === "participant" ? "/participant/login" : "/auth/register";
  const nextQuery = hasExplicitNext ? `&next=${encodeURIComponent(nextPath)}` : "";
  const fail = (code: string) => {
    const url = new URL(basePath, req.nextUrl.origin);
    url.searchParams.set("error", code);
    if (hasExplicitNext) url.searchParams.set("next", nextPath);
    const response = NextResponse.redirect(url);
    clearOAuthCookies(response, req);
    return response;
  };

  const state = req.nextUrl.searchParams.get("state") ?? "";
  const expectedState = req.cookies.get("google_oauth_state")?.value ?? "";
  const nonce = req.cookies.get("google_oauth_nonce")?.value ?? "";
  if (req.nextUrl.searchParams.get("error") || !sameSecret(state, expectedState) || !nonce) {
    return fail(req.nextUrl.searchParams.get("error") ? "google_denied" : "google_state");
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return fail("google_token");

  try {
    const idToken = await exchangeGoogleCode(code);
    const profile = await verifyGoogleIdToken(idToken, nonce);
    const resolved = await resolveGoogleAccount(profile, audience);
    if (resolved.kind === "phone") {
      const url = new URL(basePath, req.nextUrl.origin);
      url.searchParams.set("step", "phone");
      if (hasExplicitNext) url.searchParams.set("next", nextPath);
      const response = NextResponse.redirect(url);
      writeCookie(response, req, SIGNUP_INTENT_COOKIE, resolved.intentId, SIGNUP_INTENT_MAX_AGE);
      clearOAuthCookies(response, req);
      return response;
    }
    // 管理者は管理コンソール専用の入口から入る。主催者向けの画面ではチャレンジを発行しない。
    if (audience === "organizer" && resolved.user.platformRole === "ADMIN") {
      const response = NextResponse.redirect(new URL("/console/login", req.nextUrl.origin));
      clearCookie(response, req, SIGNUP_INTENT_COOKIE);
      clearOAuthCookies(response, req);
      return response;
    }
    const challenge = await startLoginChallenge({
      user: resolved.user,
      purpose: purposeForAudience(audience),
      ip: clientIp(req) ?? "local",
    });
    const destination = `${basePath}?step=login-code${nextQuery}`;
    const response = NextResponse.redirect(new URL(destination, req.nextUrl.origin));
    writeLoginChallengeCookie(response, req, challenge.id);
    clearCookie(response, req, SIGNUP_INTENT_COOKIE);
    clearOAuthCookies(response, req);
    return response;
  } catch (error) {
    const code = error instanceof GoogleAuthError ? error.code : "google_token";
    return fail(code);
  }
}

function clearOAuthCookies(response: NextResponse, req: NextRequest) {
  clearCookie(response, req, "google_oauth_state");
  clearCookie(response, req, "google_oauth_nonce");
  clearCookie(response, req, "google_oauth_next");
  clearCookie(response, req, "google_oauth_audience");
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
