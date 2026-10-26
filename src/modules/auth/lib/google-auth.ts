import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/http";
import { beginSignupIntent } from "@/modules/auth/lib/verification";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

export class GoogleAuthError extends Error {
  constructor(readonly code: "google_email" | "google_conflict" | "google_token") {
    super(code);
  }
}

export type GoogleResolution =
  | {
      kind: "session";
      user: {
        id: string;
        email: string;
        name: string;
        phoneE164: string | null;
        phoneVerifiedAt: Date | null;
        platformRole: "MEMBER" | "ADMIN";
      };
    }
  | { kind: "phone"; intentId: string };

export function googleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  return `${appBaseUrl()}/api/v1/auth/google/callback`;
}

const NEXT_PREFIXES = ["/mypage", "/organizer", "/invitations", "/events", "/participant", "/organizers"];

/** ログイン後の戻り先として安全なパスだけを通す。不正なら fallback（入口ごとの既定）へ。 */
export function safeNextPath(value: string | null | undefined, fallback = "/mypage"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("..")) {
    return fallback;
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || decoded.includes("..")) {
    return fallback;
  }
  const path = decoded.split("?")[0]?.split("#")[0] ?? "";
  const allowed = NEXT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return allowed ? decoded : fallback;
}

export function googleAuthorizeUrl(state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as { id_token?: string };
  if (!response.ok || !data.id_token) {
    throw new GoogleAuthError("google_token");
  }
  return data.id_token;
}

export async function verifyGoogleIdToken(idToken: string, nonce: string): Promise<GoogleProfile> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new GoogleAuthError("google_token");

  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub) {
    throw new GoogleAuthError("google_token");
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase().slice(0, 255) : "";
  if (!email || payload.email_verified !== true) {
    throw new GoogleAuthError("google_email");
  }
  const rawName = typeof payload.name === "string" ? payload.name.trim() : "";
  const name = (rawName || email.split("@")[0] || "会員").slice(0, 50);
  return { sub: payload.sub, email, name };
}

const sessionSelect = {
  id: true,
  email: true,
  name: true,
  phoneE164: true,
  phoneVerifiedAt: true,
  platformRole: true,
} as const;

/** ログイン・登録の入口。参加者向けは確認後の着地も変える。 */
export type AuthAudience = "organizer" | "participant";

export function resolveAudience(value: string | null | undefined): AuthAudience {
  return value === "participant" ? "participant" : "organizer";
}

export async function resolveGoogleAccount(
  profile: GoogleProfile,
  audience: AuthAudience = "organizer",
): Promise<GoogleResolution> {
  // 退会時に googleSub は NULL にするので、通常ここで退会済み行は拾わない。保険として条件に足す。
  const bySub = await prisma.user.findFirst({
    where: { googleSub: profile.sub, deletedAt: null },
    select: sessionSelect,
  });
  if (bySub) return { kind: "session", user: bySub };

  const byEmail = await prisma.user.findUnique({
    where: { email: profile.email },
    select: { id: true, googleSub: true, deletedAt: true },
  });
  if (byEmail?.deletedAt) {
    // 退会済みの行は再利用しない。新しい Google アカウントとして登録へ進む。
    const intent = await beginSignupIntent({
      email: profile.email,
      name: profile.name,
      googleSub: profile.sub,
      emailVerifiedAt: new Date(),
      audience: audience === "participant" ? "PARTICIPANT" : "ORGANIZER",
    });
    return { kind: "phone", intentId: intent.id };
  }
  if (byEmail?.googleSub && byEmail.googleSub !== profile.sub) {
    throw new GoogleAuthError("google_conflict");
  }
  if (byEmail) {
    const user = await prisma.$transaction(async (tx) => {
      const linked = await tx.user.update({
        where: { id: byEmail.id },
        data: {
          googleSub: profile.sub,
          emailVerifiedAt: new Date(),
        },
        select: sessionSelect,
      });
      await tx.userUsageQuota.upsert({
        where: { userId: linked.id },
        create: { userId: linked.id },
        update: {},
      });
      return linked;
    });
    return { kind: "session", user };
  }

  const intent = await beginSignupIntent({
    email: profile.email,
    name: profile.name,
    googleSub: profile.sub,
    emailVerifiedAt: new Date(),
    audience: audience === "participant" ? "PARTICIPANT" : "ORGANIZER",
  });
  return { kind: "phone", intentId: intent.id };
}
