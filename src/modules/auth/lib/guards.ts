import { NextRequest } from "next/server";
import type { OrganizerRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyLocalToken } from "@/modules/auth/lib/auth";
import { sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { organizerCookieName, readAuthCookie } from "@/modules/auth/lib/cookies";

export interface AuthContext {
  userId: string | null;
  guestTokenHash: string | null;
  role: OrganizerRole | null;
}

export function readAuthToken(req: NextRequest): string | null {
  const authCookie = readAuthCookie(req);
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  return authCookie || bearer || null;
}

export async function resolveUserId(req: NextRequest): Promise<string | null> {
  const token = readAuthToken(req);
  if (!token) return null;
  const verified = await verifyLocalToken(token);
  if (!verified) {
    throw new ProblemDetailException({
      status: 401,
      title: "Unauthorized",
      detail: "セッションが無効です。再度ログインしてください。",
    });
  }
  return verified.userId;
}

/**
 * 公開ページ用。セッションが無い・壊れている場合は未ログインとして扱い、401 にしない。
 * 出欠ページは未ログインでも開けるので、ログイン済みなら履歴を重ねるだけに使う。
 */
export async function resolveOptionalUserId(req: NextRequest): Promise<string | null> {
  try {
    return await resolveUserId(req);
  } catch {
    return null;
  }
}

export async function requireUserId(req: NextRequest): Promise<string> {  const userId = await resolveUserId(req);
  if (!userId) {
    throw new ProblemDetailException({
      status: 401,
      title: "Unauthorized",
      detail: "ログインが必要です。",
    });
  }
  return userId;
}

export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
}

export async function requireAdmin(req: NextRequest): Promise<AdminPrincipal> {
  const userId = await requireUserId(req);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, platformRole: true, phoneVerifiedAt: true },
  });
  if (!user || user.platformRole !== "ADMIN") {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "このページは利用できません。",
    });
  }
  if (!user.phoneVerifiedAt) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "管理者ログインには確認済みの電話番号が必要です。",
      error: "ADMIN_PHONE_REQUIRED",
    });
  }
  return { id: user.id, email: user.email, name: user.name };
}

export function collectGuestTokenHashes(req: NextRequest, eventId?: string): string[] {
  const hashes = new Set<string>();
  const headerToken = req.headers.get("x-organizer-token");
  if (headerToken) hashes.add(sha256(headerToken));
  if (eventId) {
    const cookieToken = req.cookies.get(organizerCookieName(eventId))?.value;
    if (cookieToken) hashes.add(sha256(cookieToken));
  }
  for (const cookie of req.cookies.getAll()) {
    if (!cookie.name.startsWith("org_token_") || !cookie.value) continue;
    hashes.add(sha256(cookie.value));
  }
  return [...hashes];
}

export async function resolveAuthContext(req: NextRequest, eventId?: string): Promise<AuthContext> {
  const userId = await resolveUserId(req);
  const guestHashes = eventId ? collectGuestTokenHashes(req, eventId) : [];
  const guestTokenHash = guestHashes[0] ?? null;

  let role: OrganizerRole | null = null;
  if (eventId && (userId || guestHashes.length > 0)) {
    const organizer = await prisma.eventOrganizer.findFirst({
      where: {
        eventId,
        OR: [
          ...(userId ? [{ userId }] : []),
          ...(guestHashes.length > 0 ? [{ guestTokenHash: { in: guestHashes } }] : []),
        ],
      },
    });
    if (organizer) role = organizer.role;
  }

  return { userId, guestTokenHash, role };
}

export async function assertOrganizer(req: NextRequest, eventId: string): Promise<AuthContext> {
  const ctx = await resolveAuthContext(req, eventId);
  if (!ctx.role) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "このイベントの幹事権限がありません。",
    });
  }
  return ctx;
}

export async function assertOwner(req: NextRequest, eventId: string): Promise<AuthContext> {
  const ctx = await assertOrganizer(req, eventId);
  if (ctx.role !== "OWNER") {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "この操作は筆頭幹事（オーナー）のみ実行できます。",
    });
  }
  return ctx;
}

/**
 * 出欠の管理など、会員登録が要る操作の入口。
 * 未登録の幹事は Cookie で本人と分かっても 403 REGISTER_REQUIRED にして、
 * 画面側を会員登録の案内へ送る（イベント自体は公開されたまま残す）。
 */
export async function assertRegisteredOrganizer(
  req: NextRequest,
  eventId: string,
): Promise<AuthContext & { userId: string }> {
  const ctx = await assertOrganizer(req, eventId);
  if (!ctx.userId) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      type: "probs/register-required",
      detail: "出欠の管理には会員登録が必要です。",
      error: "REGISTER_REQUIRED",
    });
  }
  return { ...ctx, userId: ctx.userId };
}

/**
 * 共同幹事の招待など、オーナーだけが実行でき、かつ会員登録が要る操作。
 * ゲストのオーナーには 403 REGISTER_REQUIRED を返す。
 */
export async function assertRegisteredOwner(
  req: NextRequest,
  eventId: string,
): Promise<AuthContext & { userId: string }> {
  const ctx = await assertRegisteredOrganizer(req, eventId);
  if (ctx.role !== "OWNER") {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "この操作は筆頭幹事（オーナー）のみ実行できます。",
    });
  }
  return ctx;
}

/**
 * イベントを1つに絞らない主催者向け API（横断の売上集計など）の入口。
 * ゲスト幹事の Cookie は本人は分かるが会員ではないので、名簿と同じく
 * 403 REGISTER_REQUIRED にして会員登録へ送る。未ログインは 401。
 */
export async function requireOrganizerAccount(req: NextRequest): Promise<string> {
  const userId = await resolveUserId(req);
  if (userId) return userId;
  if (collectGuestTokenHashes(req).length > 0) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      type: "probs/register-required",
      detail: "売上の管理には会員登録が必要です。",
      error: "REGISTER_REQUIRED",
    });
  }
  throw new ProblemDetailException({
    status: 401,
    title: "Unauthorized",
    detail: "ログインが必要です。",
  });
}

/** 未登録の幹事がイベントを作成後に、誤字直しだけできる猶予。 */export const GUEST_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * ゲスト幹事の編集猶予を判定する。作成から24時間は編集を許し、それ以降は会員登録を求める。
 * 受付停止・削除は対象外（ゲストでも自分のイベントを止められるようにする）。
 */
export function assertGuestEditWindow(ctx: AuthContext, eventCreatedAt: Date, now = Date.now()): void {
  if (ctx.userId) return;
  if (now - eventCreatedAt.getTime() <= GUEST_EDIT_WINDOW_MS) return;
  throw new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    type: "probs/register-required",
    detail: "作成から24時間を過ぎたイベントの編集には会員登録が必要です。",
    error: "REGISTER_REQUIRED",
  });
}

export async function assertLockHolder(eventId: string, lockToken: string): Promise<void> {
  const lockTokenHash = sha256(lockToken);
  const lock = await prisma.eventLock.findUnique({
    where: { eventId },
  });
  if (!lock || lock.lockTokenHash !== lockTokenHash) {
    throw new ProblemDetailException({
      status: 409,
      title: "Lock Conflict",
      type: "probs/lock-conflict",
      detail: "編集権を保持していません。他の幹事が編集中です。",
      error: "LOCK_REQUIRED",
    });
  }
}
