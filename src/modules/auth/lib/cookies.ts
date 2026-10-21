import { NextRequest, NextResponse } from "next/server";

export const AUTH_COOKIE = "auth_token";
export const AUTH_COOKIE_HOST = "__Host-auth_token";
export const RSVP_MAX_AGE = 60 * 60 * 24 * 30;
export const AUTH_MAX_AGE = 60 * 60 * 24 * 7;
export const ORGANIZER_MAX_AGE = 60 * 60 * 24 * 180;
export const FLYER_OWNER_COOKIE = "flyer_owner";
export const FLYER_OWNER_MAX_AGE = 60 * 60 * 24 * 180;
export const SIGNUP_INTENT_COOKIE = "signup_intent";
export const SIGNUP_INTENT_MAX_AGE = 60 * 60 * 24;
export const LOGIN_CHALLENGE_COOKIE = "login_challenge";
export const LOGIN_CHALLENGE_COOKIE_HOST = "__Host-login_challenge";
export const LOGIN_CHALLENGE_MAX_AGE = 60 * 10;

export function rsvpCookieName(eventId: string): string {
  return `rsvp_token_${eventId}`;
}

export function organizerCookieName(eventId: string): string {
  return `org_token_${eventId}`;
}

export function authCookieName(req: NextRequest): string {
  return requestIsSecure(req) ? AUTH_COOKIE_HOST : AUTH_COOKIE;
}

export function readAuthCookie(req: NextRequest): string | null {
  return req.cookies.get(AUTH_COOKIE_HOST)?.value ?? req.cookies.get(AUTH_COOKIE)?.value ?? null;
}

export function loginChallengeCookieName(req: NextRequest): string {
  return requestIsSecure(req) ? LOGIN_CHALLENGE_COOKIE_HOST : LOGIN_CHALLENGE_COOKIE;
}

export function readLoginChallengeCookie(req: NextRequest): string | null {
  return req.cookies.get(LOGIN_CHALLENGE_COOKIE_HOST)?.value ?? req.cookies.get(LOGIN_CHALLENGE_COOKIE)?.value ?? null;
}

export function clearAuthCookies(response: NextResponse, req: NextRequest): void {
  clearCookie(response, req, AUTH_COOKIE);
  clearCookie(response, req, AUTH_COOKIE_HOST);
}

export function requestIsSecure(req: NextRequest): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0].trim() === "https";
  }
  return req.nextUrl.protocol === "https:";
}

export function writeCookie(
  response: NextResponse,
  req: NextRequest,
  name: string,
  value: string,
  maxAge: number,
): void {
  response.cookies.set({
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(req),
    path: "/",
    maxAge,
  });
}

export function clearCookie(response: NextResponse, req: NextRequest, name: string): void {
  response.cookies.set({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: requestIsSecure(req),
    path: "/",
    maxAge: 0,
  });
}

export function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}
