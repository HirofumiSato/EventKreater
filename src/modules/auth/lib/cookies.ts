import { NextRequest, NextResponse } from "next/server";
import { isIP } from "node:net";

export const AUTH_COOKIE = "auth_token";
export const AUTH_COOKIE_HOST = "__Host-auth_token";
export const RSVP_MAX_AGE = 60 * 60 * 24 * 30;
export const AUTH_MAX_AGE = 60 * 60 * 24 * 7;
export const ORGANIZER_MAX_AGE = 60 * 60 * 24 * 180;
export const FLYER_OWNER_COOKIE = "flyer_owner";
export const FLYER_OWNER_MAX_AGE = 60 * 60 * 24 * 180;
/** 未登録の幹事が入力した会場を、この端末の候補として覚えておくための Cookie。 */
export const VENUE_OWNER_COOKIE = "venue_owner";
export const VENUE_OWNER_MAX_AGE = 60 * 60 * 24 * 180;
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

/**
 * 前段が付けるクライアント IP のヘッダ。左ほど優先する。
 *
 * 本番は Cloudflare → Fly.io → アプリ の順に通る。Cloudflare は
 * `cf-connecting-ip` を必ず上書きするので、これが最も信頼できる。
 */
const TRUSTED_CLIENT_IP_HEADERS = ["cf-connecting-ip", "fly-client-ip", "x-real-ip"] as const;

/** ヘッダの値を IP として通す。`1.2.3.4:5678` や `[::1]` の形も受ける。 */
function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!value) return null;
  if (isIP(value)) return value;
  // IPv4 のポート付き。IPv6 は上で通っているので、ここで削ると壊れる。
  const withoutPort = value.replace(/:\d+$/, "");
  return isIP(withoutPort) ? withoutPort : null;
}

/**
 * クライアント IP。認証のレート制限の鍵に使う。
 *
 * `x-forwarded-for` の先頭はブラウザが自由に書ける。先頭を採ると、値を
 * 変えるだけで IP 単位の上限を素通りできる。前段が上書きするヘッダを先に
 * 見て、無いときだけ `x-forwarded-for` の末尾（直前のプロキシが付けた値）
 * を採る。
 *
 * 前段を挟まずオリジンを直接公開すると、どのヘッダも名乗り放題になる。
 * Cloudflare 以外からの接続は塞いでおくこと。
 */
export function clientIp(req: NextRequest): string | null {
  for (const name of TRUSTED_CLIENT_IP_HEADERS) {
    const ip = normalizeIp(req.headers.get(name));
    if (ip) return ip;
  }
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const values = forwarded.split(",");
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const ip = normalizeIp(values[index]);
      if (ip) return ip;
    }
  }
  return null;
}
