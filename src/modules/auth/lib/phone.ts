import { randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { ProblemDetailException, isUniqueViolation } from "@/lib/exceptions";
import { deliverSms } from "@/lib/sms";
import { assertWithinAttemptLimit, recordAuthAttempt } from "@/modules/auth/lib/rate-limit";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;

const INVALID_CODE = "確認コードが正しくないか、期限が切れています。";
const PHONE_TAKEN = "この電話番号は別の会員に使われています。登録済みの方法でログインしてください。";

export interface PhoneSubject {
  userId: string | null;
  intentId: string | null;
}

export function toE164(raw: string): string | null {
  const compact = raw.trim().replace(/[\s\-()]/g, "");
  if (compact.startsWith("+")) {
    const digits = compact.slice(1);
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    return `+${digits}`;
  }
  if (/^81[1-9]\d{8,12}$/.test(compact)) return `+${compact}`;
  if (/^0\d{9,10}$/.test(compact)) return `+81${compact.slice(1)}`;
  return null;
}

function codeHash(phoneE164: string, code: string): string {
  const pepper = process.env.JWT_SECRET ?? "phone";
  return sha256(`${pepper}:${phoneE164}:${code}`);
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function invalidPhone(): ProblemDetailException {
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail: "電話番号の形式が正しくありません。",
  });
}

function invalidCode(): ProblemDetailException {
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail: INVALID_CODE,
  });
}

function phoneTaken(): ProblemDetailException {
  return new ProblemDetailException({
    status: 409,
    title: "Conflict",
    type: "probs/conflict",
    detail: PHONE_TAKEN,
    error: "PHONE_CONFLICT",
  });
}

function missingSubject(): ProblemDetailException {
  return new ProblemDetailException({
    status: 401,
    title: "Unauthorized",
    detail: "電話番号の確認を始めるには、メールの確認かログインが必要です。",
  });
}

async function assertSubject(subject: PhoneSubject): Promise<void> {
  if (subject.userId) {
    const user = await prisma.user.findUnique({
      where: { id: subject.userId },
      select: { id: true },
    });
    if (!user) throw missingSubject();
    return;
  }
  if (!subject.intentId) throw missingSubject();
  const intent = await prisma.signupIntent.findUnique({ where: { id: subject.intentId } });
  if (!intent || !intent.emailVerifiedAt || intent.expiresAt <= new Date()) {
    throw missingSubject();
  }
}

export async function startPhoneVerification(input: PhoneSubject & { phoneRaw: string; ip: string }): Promise<{ alreadyVerified: boolean }> {
  const phoneE164 = toE164(input.phoneRaw);
  if (!phoneE164) throw invalidPhone();
  await assertSubject(input);

  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { phoneE164: true, phoneVerifiedAt: true },
    });
    if (user?.phoneVerifiedAt) return { alreadyVerified: true };
  }

  await assertWithinAttemptLimit(`phone:start:number:${phoneE164}`, 3, HOUR_MS);
  await assertWithinAttemptLimit(`phone:start:ip:${input.ip}`, 8, HOUR_MS);
  await recordAuthAttempt(`phone:start:number:${phoneE164}`);
  await recordAuthAttempt(`phone:start:ip:${input.ip}`);

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.$transaction([
    prisma.phoneVerificationCode.deleteMany({
      where: {
        phoneE164,
        usedAt: null,
        ...(input.userId ? { userId: input.userId } : { signupIntentId: input.intentId }),
      },
    }),
    prisma.phoneVerificationCode.create({
      data: {
        phoneE164,
        codeHash: codeHash(phoneE164, code),
        userId: input.userId,
        signupIntentId: input.userId ? null : input.intentId,
        expiresAt,
      },
    }),
  ]);
  await deliverSms({
    to: phoneE164,
    body: `確認コードは ${code} です。10分で無効になります。`,
  });
  return { alreadyVerified: false };
}

const userSelect = { id: true, email: true, name: true } as const;

/**
 * マイページからの電話番号変更。確認済みでも新しい番号へ SMS を送る。
 * すでに確認済みかどうかで早期終了しない点だけ startPhoneVerification と違う。
 */
export async function assertPhoneChangeable(userId: string, phoneRaw: string): Promise<string> {
  const phoneE164 = toE164(phoneRaw);
  if (!phoneE164) throw invalidPhone();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phoneE164: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "会員が見つかりません。",
    });
  }
  if (user.phoneE164 === phoneE164) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "現在と同じ電話番号です。",
      error: "PHONE_UNCHANGED",
    });
  }
  const owner = await prisma.user.findFirst({
    where: { phoneE164, NOT: { id: user.id } },
    select: { id: true },
  });
  if (owner) throw phoneTaken();
  return phoneE164;
}

export async function startPhoneChangeVerification(input: {
  userId: string;
  phoneRaw: string;
  ip: string;
}): Promise<{ phoneE164: string }> {
  const phoneE164 = await assertPhoneChangeable(input.userId, input.phoneRaw);

  await assertWithinAttemptLimit(`phone:change:number:${phoneE164}`, 3, HOUR_MS);
  await assertWithinAttemptLimit(`phone:change:ip:${input.ip}`, 8, HOUR_MS);
  await recordAuthAttempt(`phone:change:number:${phoneE164}`);
  await recordAuthAttempt(`phone:change:ip:${input.ip}`);

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.$transaction([
    prisma.phoneVerificationCode.deleteMany({
      where: { phoneE164, usedAt: null, userId: input.userId },
    }),
    prisma.phoneVerificationCode.create({
      data: { phoneE164, codeHash: codeHash(phoneE164, code), userId: input.userId, expiresAt },
    }),
  ]);
  await deliverSms({
    to: phoneE164,
    body: `確認コードは ${code} です。10分で無効になります。`,
  });
  return { phoneE164 };
}

/** 電話番号変更の確定。既存のコード行を照合してから、同じ会員行の番号を差し替える。 */
export async function confirmPhoneChangeVerification(input: {
  userId: string;
  phoneRaw: string;
  code: string;
  ip: string;
}): Promise<{ id: string; email: string; name: string; phoneE164: string }> {
  const phoneE164 = toE164(input.phoneRaw);
  if (!phoneE164 || !/^\d{6}$/.test(input.code)) throw invalidCode();
  await assertWithinAttemptLimit(`phone:change:confirm:ip:${input.ip}`, 20, HOUR_MS);

  const codeRow = await prisma.phoneVerificationCode.findFirst({
    where: { phoneE164, usedAt: null, expiresAt: { gt: new Date() }, userId: input.userId },
    orderBy: { createdAt: "desc" },
  });
  if (!codeRow || codeRow.attempts >= MAX_ATTEMPTS) throw invalidCode();
  if (!hashesEqual(codeRow.codeHash, codeHash(phoneE164, input.code))) {
    await prisma.phoneVerificationCode.update({
      where: { id: codeRow.id },
      data: { attempts: { increment: 1 } },
    });
    await recordAuthAttempt(`phone:change:confirm:ip:${input.ip}`);
    throw invalidCode();
  }
  const user = await attachPhoneToUser(input.userId, phoneE164, codeRow.id);
  return { ...user, phoneE164 };
}

export async function confirmPhoneVerification(
  input: PhoneSubject & { phoneRaw: string; code: string; ip: string },
): Promise<{
  user: { id: string; email: string; name: string };
  attachedExisting: boolean;
  reactivated: boolean;
}> {
  const phoneE164 = toE164(input.phoneRaw);
  if (!phoneE164 || !/^\d{6}$/.test(input.code)) throw invalidCode();
  await assertSubject(input);
  await assertWithinAttemptLimit(`phone:confirm:ip:${input.ip}`, 20, HOUR_MS);

  const codeRow = await prisma.phoneVerificationCode.findFirst({
    where: {
      phoneE164,
      usedAt: null,
      expiresAt: { gt: new Date() },
      ...(input.userId ? { userId: input.userId } : { signupIntentId: input.intentId }),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!codeRow || codeRow.attempts >= MAX_ATTEMPTS) throw invalidCode();
  if (!hashesEqual(codeRow.codeHash, codeHash(phoneE164, input.code))) {
    await prisma.phoneVerificationCode.update({
      where: { id: codeRow.id },
      data: { attempts: { increment: 1 } },
    });
    await recordAuthAttempt(`phone:confirm:ip:${input.ip}`);
    throw invalidCode();
  }

  if (input.userId) {
    const user = await attachPhoneToUser(input.userId, phoneE164, codeRow.id);
    return { user, attachedExisting: false, reactivated: false };
  }
  return completeSignup(input.intentId as string, phoneE164, codeRow.id);
}

async function attachPhoneToUser(userId: string, phoneE164: string, codeId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const marked = await tx.phoneVerificationCode.updateMany({
        where: { id: codeId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (marked.count !== 1) throw invalidCode();
      const owner = await tx.user.findUnique({ where: { phoneE164 }, select: { id: true } });
      if (owner && owner.id !== userId) throw phoneTaken();
      return tx.user.update({
        where: { id: userId },
        data: { phoneE164, phoneVerifiedAt: new Date() },
        select: userSelect,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw phoneTaken();
    throw error;
  }
}

async function completeSignup(intentId: string, phoneE164: string, codeId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const marked = await tx.phoneVerificationCode.updateMany({
        where: { id: codeId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (marked.count !== 1) throw invalidCode();

      const intent = await tx.signupIntent.findUnique({ where: { id: intentId } });
      if (!intent || !intent.emailVerifiedAt || intent.expiresAt <= new Date()) throw invalidCode();

      const byPhone = await tx.user.findUnique({ where: { phoneE164 } });
      const byEmail = await tx.user.findUnique({ where: { email: intent.email } });
      const bySub = intent.googleSub
        ? await tx.user.findUnique({ where: { googleSub: intent.googleSub } })
        : null;
      const ids = new Set([byPhone?.id, byEmail?.id, bySub?.id].filter((id): id is string => Boolean(id)));
      if (ids.size > 1) throw phoneTaken();

      const target = bySub ?? byEmail ?? byPhone;
      if (target?.deletedAt) {
        // 退会済みの会員。確認済みの電話番号が一致するので本人とみなし、同じ行と利用枠を引き継ぐ。
        // user_usage_quotas は update: {} で触らないため、消化済みの無料枠は戻らない。
        const user = await tx.user.update({
          where: { id: target.id },
          data: {
            deletedAt: null,
            email: intent.email,
            name: intent.name,
            passwordHash: intent.passwordHash,
            googleSub: intent.googleSub,
            emailVerifiedAt: intent.emailVerifiedAt ?? new Date(),
            phoneE164,
            phoneVerifiedAt: target.phoneVerifiedAt ?? new Date(),
          },
          select: userSelect,
        });
        await tx.userUsageQuota.upsert({
          where: { userId: user.id },
          create: { userId: user.id },
          update: {},
        });
        await tx.accountChangeLog.create({
          data: { userId: user.id, kind: "REACTIVATE" },
        });
        await tx.signupIntent.delete({ where: { id: intent.id } });
        return { user, attachedExisting: true, reactivated: true };
      }
      if (target) {
        if (intent.googleSub && target.googleSub && target.googleSub !== intent.googleSub) throw phoneTaken();
        if (target.phoneE164 && target.phoneE164 !== phoneE164) throw phoneTaken();
        const user = await tx.user.update({
          where: { id: target.id },
          data: {
            phoneE164,
            phoneVerifiedAt: target.phoneVerifiedAt ?? new Date(),
            ...(intent.googleSub && !target.googleSub ? { googleSub: intent.googleSub } : {}),
            ...(intent.passwordHash && !target.passwordHash && target.email === intent.email
              ? { passwordHash: intent.passwordHash }
              : {}),
            ...(!target.emailVerifiedAt && target.email === intent.email ? { emailVerifiedAt: new Date() } : {}),
          },
          select: userSelect,
        });
        await tx.userUsageQuota.upsert({
          where: { userId: user.id },
          create: { userId: user.id },
          update: {},
        });
        await tx.signupIntent.delete({ where: { id: intent.id } });
        return { user, attachedExisting: true, reactivated: false };
      }

      const user = await tx.user.create({
        data: {
          email: intent.email,
          name: intent.name,
          passwordHash: intent.passwordHash,
          googleSub: intent.googleSub,
          emailVerifiedAt: intent.emailVerifiedAt,
          phoneE164,
          phoneVerifiedAt: new Date(),
          quota: { create: {} },
        },
        select: userSelect,
      });
      await tx.signupIntent.delete({ where: { id: intent.id } });
      return { user, attachedExisting: false, reactivated: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw phoneTaken();
    throw error;
  }
}
