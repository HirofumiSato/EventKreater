import { randomInt, timingSafeEqual } from "crypto";
import type { LoginChallengeChannel, LoginChallengePurpose, User } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { deliverMail } from "@/lib/mail";
import { deliverSms } from "@/lib/sms";
import { ProblemDetailException } from "@/lib/exceptions";
import { signLocalToken } from "@/modules/auth/lib/auth";
import {
  assertWithinAttemptLimit,
  bucketOf,
  clearAttempts,
  countAttempts,
  recordAuthAttempt,
} from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS } from "@/modules/auth/lib/rate-limits";
import {
  AUTH_MAX_AGE,
  LOGIN_CHALLENGE_MAX_AGE,
  authCookieName,
  clearCookie,
  loginChallengeCookieName,
  readLoginChallengeCookie,
  writeCookie,
} from "@/modules/auth/lib/cookies";

const CODE_TTL_MS = 10 * 60 * 1000;
const { codeMaxAttempts: MAX_ATTEMPTS, lockMs: LOCK_MS } = AUTH_RATE_LIMITS;
/** この回数以上間違えたら、残り回数を画面に出す。 */
const ATTEMPT_WARN_AFTER_FAILURES = 3;
const INVALID_CODE = "確認番号が正しくないか、期限が切れています。";

export type ChallengeUser = Pick<
  User,
  "id" | "email" | "name" | "phoneE164" | "phoneVerifiedAt" | "platformRole"
>;

export interface LoginChallengePublic {
  challengeRequired: true;
  channel: LoginChallengeChannel;
  destinationMask: string;
  canUseSms: boolean;
  canUseEmail: boolean;
  purpose: LoginChallengePurpose;
  /** あと何回まで確認番号を間違えられるか。 */
  attemptsRemaining: number;
  attemptLimit: number;
  lockMinutes: number;
}

function codeHash(challengeId: string, code: string): string {
  const pepper = process.env.JWT_SECRET ?? "login";
  return sha256(`${pepper}:${challengeId}:${code}`);
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phoneE164: string): string {
  if (phoneE164.startsWith("+81") && phoneE164.length >= 8) {
    const local = `0${phoneE164.slice(3)}`;
    return `${local.slice(0, 3)}****${local.slice(-4)}`;
  }
  if (phoneE164.length < 6) return "****";
  return `${phoneE164.slice(0, 3)}****${phoneE164.slice(-4)}`;
}

function invalidCode(remaining?: number): ProblemDetailException {
  const failures = remaining === undefined ? 0 : MAX_ATTEMPTS - remaining;
  const warn = remaining !== undefined && remaining > 0 && failures >= ATTEMPT_WARN_AFTER_FAILURES;
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail: warn
      ? `確認番号が正しくありません。あと${remaining}回でアカウントがロックされます。`
      : INVALID_CODE,
    ...(remaining !== undefined
      ? {
          remainingAttempts: Math.max(0, remaining),
          attemptLimit: MAX_ATTEMPTS,
          lockMinutes: LOCK_MS / 60_000,
        }
      : {}),
  });
}

/** 確認番号の失敗回数を数えるバケット。チャレンジを発行し直しても引き継ぐ。 */
function failureBucket(userId: string): string {
  return bucketOf(AUTH_RATE_LIMITS.rules.loginChallengeFailure, userId);
}

/** アカウントのロック開始時刻を持つバケット。 */
function lockBucket(userId: string): string {
  return `login-2fa:lock:user:${userId}`;
}

function lockedAccount(until: Date): ProblemDetailException {
  const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return new ProblemDetailException({
    status: 423,
    title: "Locked",
    type: "probs/account-locked",
    detail: `確認番号を${MAX_ATTEMPTS}回間違えたため、アカウントを一時的にロックしています。約${minutes}分後に自動で解除されます。`,
    error: "ACCOUNT_LOCKED",
    lockedUntil: until.toISOString(),
    retryAfterSeconds,
  });
}

async function lockExpiresAt(userId: string): Promise<Date | null> {
  const latest = await prisma.authAttempt.findFirst({
    where: { bucket: lockBucket(userId) },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!latest) return null;
  const until = new Date(latest.createdAt.getTime() + LOCK_MS);
  return until > new Date() ? until : null;
}

async function assertNotLocked(userId: string): Promise<void> {
  const until = await lockExpiresAt(userId);
  if (until) throw lockedAccount(until);
}

async function lockAccount(userId: string): Promise<Date> {
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_MS);
  await prisma.$transaction([
    prisma.authAttempt.deleteMany({ where: { bucket: lockBucket(userId) } }),
    prisma.authAttempt.create({ data: { bucket: lockBucket(userId), createdAt: now } }),
    // 発行済みの確認番号も同時に閉じる。
    prisma.loginChallenge.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } }),
  ]);
  return until;
}

function missingChallenge(): ProblemDetailException {
  return new ProblemDetailException({
    status: 401,
    title: "Unauthorized",
    detail: "確認番号の入力からやり直してください。",
  });
}

function adminPhoneRequired(): ProblemDetailException {
  return new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    detail: "管理者ログインには確認済みの電話番号が必要です。会員ログインから電話番号を確認してください。",
    error: "ADMIN_PHONE_REQUIRED",
  });
}

/** 管理者は管理コンソール専用の入口から入る。主催者向けのログインでは発行しない。 */
function adminConsoleRequired(): ProblemDetailException {
  return new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    detail: "管理者アカウントは /console/login からのみログインできます。",
    error: "ADMIN_CONSOLE_REQUIRED",
  });
}

function assertMemberPurposeAllowed(user: ChallengeUser, purpose: LoginChallengePurpose): void {
  // 主催者の入口（MEMBER）だけ管理者を締め出す。参加者の入口は誰でも通す。
  if (purpose === "MEMBER" && user.platformRole === "ADMIN") throw adminConsoleRequired();
}

function defaultChannel(user: ChallengeUser): LoginChallengeChannel {
  return user.phoneVerifiedAt && user.phoneE164 ? "SMS" : "EMAIL";
}

function destinationMask(user: ChallengeUser, channel: LoginChallengeChannel): string {
  if (channel === "SMS") return maskPhone(user.phoneE164 ?? "");
  return maskEmail(user.email);
}

function publicView(
  user: ChallengeUser,
  channel: LoginChallengeChannel,
  purpose: LoginChallengePurpose,
  attemptsRemaining: number,
): LoginChallengePublic {
  return {
    challengeRequired: true,
    channel,
    destinationMask: destinationMask(user, channel),
    canUseSms: Boolean(user.phoneVerifiedAt && user.phoneE164),
    canUseEmail: true,
    purpose,
    attemptsRemaining,
    attemptLimit: MAX_ATTEMPTS,
    lockMinutes: LOCK_MS / 60_000,
  };
}

async function deliver(user: ChallengeUser, channel: LoginChallengeChannel, code: string): Promise<void> {
  if (channel === "SMS") {
    if (!user.phoneE164) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "このアカウントには確認済みの電話番号がありません。",
      });
    }
    await deliverSms({
      to: user.phoneE164,
      body: `確認番号は ${code} です。10分以内に入力してください。`,
    });
    return;
  }
  const body = `確認番号は ${code} です。10分以内に入力してください。このメールに心当たりがないときは破棄してください。`;
  const status = await deliverMail({
    to: user.email,
    subject: "ログイン確認番号",
    body,
  });
  if (status === "RECORDED") console.info(`[mail] ${user.email}: ${body}`);
}

export function writeLoginChallengeCookie(response: NextResponse, req: NextRequest, challengeId: string): void {
  writeCookie(response, req, loginChallengeCookieName(req), challengeId, LOGIN_CHALLENGE_MAX_AGE);
}

export function clearLoginChallengeCookies(response: NextResponse, req: NextRequest): void {
  clearCookie(response, req, "login_challenge");
  clearCookie(response, req, "__Host-login_challenge");
}

export function challengeResponse(req: NextRequest, challengeId: string, view: LoginChallengePublic): NextResponse {
  const response = NextResponse.json(view);
  writeLoginChallengeCookie(response, req, challengeId);
  return response;
}

export async function startLoginChallenge(input: {
  user: ChallengeUser;
  purpose: LoginChallengePurpose;
  ip: string;
}): Promise<{ id: string; view: LoginChallengePublic }> {
  await assertNotLocked(input.user.id);
  if (input.purpose === "ADMIN") {
    if (input.user.platformRole !== "ADMIN" || !input.user.phoneVerifiedAt || !input.user.phoneE164) {
      throw adminPhoneRequired();
    }
  }
  const channel = defaultChannel(input.user);
  return issueChallenge({ user: input.user, purpose: input.purpose, channel, ip: input.ip });
}

/**
 * マイページの再認証（メール変更・電話番号変更・パスワード変更・退会）用の確認番号。
 * ログインの purpose では管理者が締め出されるため PARTICIPANT を使い、成功時もセッションは作らない。
 */
export async function startAccountChallenge(input: {
  user: ChallengeUser;
  channel?: LoginChallengeChannel;
  ip: string;
}): Promise<{ id: string; view: LoginChallengePublic }> {
  await assertNotLocked(input.user.id);
  const channel = input.channel ?? defaultChannel(input.user);
  if (channel === "SMS" && !(input.user.phoneVerifiedAt && input.user.phoneE164)) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "このアカウントには確認済みの電話番号がありません。",
    });
  }
  return issueChallenge({ user: input.user, purpose: "PARTICIPANT", channel, ip: input.ip });
}

async function issueChallenge(input: {
  user: ChallengeUser;
  purpose: LoginChallengePurpose;
  channel: LoginChallengeChannel;
  ip: string;
}): Promise<{ id: string; view: LoginChallengePublic }> {
  await assertNotLocked(input.user.id);
  assertMemberPurposeAllowed(input.user, input.purpose);
  if (input.channel === "SMS") {
    await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.loginSmsUser, input.user.id);
    await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.loginSmsIp, input.ip);
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.loginSmsUser, input.user.id);
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.loginSmsIp, input.ip);
  } else {
    await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.loginEmailChallengeUser, input.user.id);
    await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.loginEmailChallengeIp, input.ip);
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.loginEmailChallengeUser, input.user.id);
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.loginEmailChallengeIp, input.ip);
  }

  await prisma.loginChallenge.updateMany({
    where: { userId: input.user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const created = await prisma.loginChallenge.create({
    data: {
      userId: input.user.id,
      purpose: input.purpose,
      channel: input.channel,
      codeHash: sha256(`pending:${input.user.id}:${Date.now()}`),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  const code = sixDigits();
  await prisma.loginChallenge.update({
    where: { id: created.id },
    data: { codeHash: codeHash(created.id, code) },
  });
  await deliver(input.user, input.channel, code);
  const failures = await countAttempts(failureBucket(input.user.id), LOCK_MS);
  return {
    id: created.id,
    view: publicView(input.user, input.channel, input.purpose, Math.max(0, MAX_ATTEMPTS - failures)),
  };
}

export async function readActiveChallenge(req: NextRequest): Promise<{
  challenge: { id: string; channel: LoginChallengeChannel; purpose: LoginChallengePurpose; attempts: number };
  user: ChallengeUser;
}> {
  const id = readLoginChallengeCookie(req);
  if (!id) throw missingChallenge();
  const challenge = await prisma.loginChallenge.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          phoneE164: true,
          phoneVerifiedAt: true,
          platformRole: true,
        },
      },
    },
  });
  if (!challenge || challenge.usedAt || challenge.expiresAt <= new Date()) {
    throw missingChallenge();
  }
  return {
    challenge: {
      id: challenge.id,
      channel: challenge.channel,
      purpose: challenge.purpose,
      attempts: challenge.attempts,
    },
    user: challenge.user,
  };
}

export async function currentLoginChallenge(req: NextRequest): Promise<LoginChallengePublic> {
  const { challenge, user } = await readActiveChallenge(req);
  await assertNotLocked(user.id);
  const failures = await countAttempts(failureBucket(user.id), LOCK_MS);
  return publicView(user, challenge.channel, challenge.purpose, Math.max(0, MAX_ATTEMPTS - failures));
}

export async function switchLoginChallengeChannel(input: {
  req: NextRequest;
  channel: LoginChallengeChannel;
  ip: string;
}): Promise<{ id: string; view: LoginChallengePublic }> {
  const { challenge, user } = await readActiveChallenge(input.req);
  await assertNotLocked(user.id);
  if (input.channel === "SMS" && !(user.phoneVerifiedAt && user.phoneE164)) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "このアカウントには確認済みの電話番号がありません。",
    });
  }
  return issueChallenge({
    user,
    purpose: challenge.purpose,
    channel: input.channel,
    ip: input.ip,
  });
}

async function verifyChallenge(input: {
  req: NextRequest;
  code: string;
  ip: string;
}): Promise<{ user: ChallengeUser; challengeId: string; purpose: LoginChallengePurpose }> {
  if (!/^\d{6}$/.test(input.code)) throw invalidCode();
  await assertWithinAttemptLimit(AUTH_RATE_LIMITS.rules.loginConfirmIp, input.ip);
  const { challenge, user } = await readActiveChallenge(input.req);
  await assertNotLocked(user.id);
  assertMemberPurposeAllowed(user, challenge.purpose);
  const row = await prisma.loginChallenge.findUnique({ where: { id: challenge.id } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) throw missingChallenge();

  const failBucket = failureBucket(user.id);
  const failures = await countAttempts(failBucket, LOCK_MS);
  if (failures >= MAX_ATTEMPTS) {
    await clearAttempts(failBucket);
    throw lockedAccount(await lockAccount(user.id));
  }

  if (!hashesEqual(row.codeHash, codeHash(row.id, input.code))) {
    const failed = failures + 1;
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.loginChallengeFailure, user.id);
    await prisma.loginChallenge.update({
      where: { id: row.id },
      data: { attempts: failed },
    });
    await recordAuthAttempt(AUTH_RATE_LIMITS.rules.loginConfirmIp, input.ip);
    if (failed >= MAX_ATTEMPTS) {
      await clearAttempts(failBucket);
      throw lockedAccount(await lockAccount(user.id));
    }
    throw invalidCode(MAX_ATTEMPTS - failed);
  }

  // 成功したら失敗の数え直しをやめる。
  await clearAttempts(failBucket);
  await prisma.loginChallenge.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  return { user, challengeId: row.id, purpose: challenge.purpose };
}

export async function confirmLoginChallenge(input: {
  req: NextRequest;
  code: string;
  ip: string;
}): Promise<{ user: ChallengeUser; token: string; purpose: LoginChallengePurpose }> {
  const { user, purpose } = await verifyChallenge(input);
  const token = await signLocalToken({ userId: user.id, email: user.email });
  return { user, token, purpose };
}

/**
 * 確認番号を検証するだけで、ログインセッションは発行しない。
 * マイページの再認証に使う。成功したチャレンジは使用済みにする。
 */
export async function confirmAccountChallenge(input: {
  req: NextRequest;
  code: string;
  ip: string;
}): Promise<ChallengeUser> {
  const { user } = await verifyChallenge(input);
  return user;
}

/** ログイン入口の種別を LoginChallengePurpose に写す。 */
export function purposeForAudience(audience: "organizer" | "participant" | undefined): LoginChallengePurpose {
  return audience === "participant" ? "PARTICIPANT" : "MEMBER";
}

export function sessionFromChallenge(
  req: NextRequest,
  token: string,
  user: ChallengeUser,
  extra: Record<string, unknown> = {},
): NextResponse {
  const response = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
    platformRole: user.platformRole,
    phoneVerified: Boolean(user.phoneVerifiedAt),
    ...extra,
  });
  writeCookie(response, req, authCookieName(req), token, AUTH_MAX_AGE);
  clearLoginChallengeCookies(response, req);
  return response;
}
