import { randomBytes } from "crypto";
import type { AccountChangeKind, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { appBaseUrl } from "@/lib/http";
import { deliverMail } from "@/lib/mail";
import { ProblemDetailException, isUniqueViolation } from "@/lib/exceptions";
import { hashPassword, passwordMatches } from "@/modules/auth/lib/auth";
import { clientIp } from "@/modules/auth/lib/cookies";
import { assertPasswordNotBreached } from "@/modules/auth/lib/pwned";
import { maskEmail } from "@/modules/auth/lib/login-challenge";

const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

/** 退会した会員のメールアドレス。元のアドレスを解放して再登録できるようにする。 */
export function anonymizedEmail(userId: string): string {
  return `deleted+${userId}@deleted.invalid`;
}

export const WITHDRAWN_NAME = "退会した会員";

/** 監査ログに入れる IP のハッシュ。生の IP は残さない。 */
export function requestIpHash(req: NextRequest): string | null {
  const ip = clientIp(req);
  return ip ? sha256(ip) : null;
}

export function emailTaken(): ProblemDetailException {
  return new ProblemDetailException({
    status: 409,
    title: "Conflict",
    type: "probs/conflict",
    detail: "このメールアドレスは既に使われています。",
    error: "EMAIL_CONFLICT",
  });
}

function userNotFound(): ProblemDetailException {
  return new ProblemDetailException({
    status: 404,
    title: "Not Found",
    detail: "会員が見つかりません。",
  });
}

/**
 * 会員が自分の情報を変えた記録を残す。
 * 値はマスク済みのものだけを入れ、パスワードは決して入れない。
 */
export async function recordAccountChange(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    kind: AccountChangeKind;
    beforeValue?: string | null;
    afterValue?: string | null;
    ipHash?: string | null;
  },
): Promise<void> {
  await tx.accountChangeLog.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      beforeValue: input.beforeValue ?? null,
      afterValue: input.afterValue ?? null,
      ipHash: input.ipHash ?? null,
    },
  });
}

/** セッションを全失効し、いま使っている端末だけを残す。 */
export async function revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<void> {
  await prisma.authSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keepSessionId ? { NOT: { id: keepSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}

/** 表示名の変更。1〜50 文字に収める。 */
export async function updateDisplayName(input: {
  userId: string;
  name: string;
  ipHash: string | null;
}): Promise<{ id: string; email: string; name: string }> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 50) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "表示名は1文字以上50文字以内で入力してください。",
    });
  }
  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { name: true },
    });
    if (!current) throw userNotFound();
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { name },
      select: { id: true, email: true, name: true },
    });
    await recordAccountChange(tx, {
      userId: input.userId,
      kind: "NAME",
      beforeValue: current.name,
      afterValue: name,
      ipHash: input.ipHash,
    });
    return updated;
  });
}

/**
 * パスワードの変更。本人確認（現在のパスワード or 確認番号）は呼び出し側で済ませておく。
 * Google のみの会員は、この経路で初めてパスワードを設定できる。
 */
export async function changePassword(input: {
  userId: string;
  newPassword: string;
  ipHash: string | null;
}): Promise<void> {
  if (input.newPassword.length < 8 || input.newPassword.length > 128) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "パスワードは8文字以上128文字以内にしてください。",
    });
  }
  await assertPasswordNotBreached(input.newPassword);
  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { passwordHash: true },
    });
    if (!current) throw userNotFound();
    // 同じ会員の別操作が先にパスワードを変えていたら、上書きしない。
    const updated = await tx.user.updateMany({
      where: { id: input.userId, passwordHash: current.passwordHash },
      data: { passwordHash },
    });
    if (updated.count !== 1) {
      throw new ProblemDetailException({
        status: 409,
        title: "Conflict",
        detail: "パスワードが別の操作で変更されました。もう一度お試しください。",
        error: "PASSWORD_CHANGED",
      });
    }
    await recordAccountChange(tx, { userId: input.userId, kind: "PASSWORD", ipHash: input.ipHash });
  });
}

export interface PendingEmailChange {
  maskedEmail: string;
  expiresAt: string;
}

/**
 * 変更先として使えるメールアドレスかを、本人確認より前に確かめる。
 * ここで弾けば、確認番号を無駄に消費させない。
 */
export async function assertEmailChangeable(userId: string, rawEmail: string): Promise<string> {
  const newEmail = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail) || newEmail.length > 255) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "メールアドレスの形式が正しくありません。",
    });
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true },
  });
  if (!user) throw userNotFound();
  if (newEmail === user.email) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "現在と同じメールアドレスです。",
      error: "EMAIL_UNCHANGED",
    });
  }
  const taken = await prisma.user.findFirst({ where: { email: newEmail }, select: { id: true } });
  if (taken) throw emailTaken();
  return newEmail;
}

/** メールアドレス変更の第2段階。新しいアドレスへ確認リンクを送る。 */
export async function startEmailChange(input: {
  userId: string;
  newEmail: string;
  ipHash: string | null;
}): Promise<PendingEmailChange> {
  const newEmail = await assertEmailChangeable(input.userId, input.newEmail);
  const user = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true, email: true, name: true },
  });
  if (!user) throw userNotFound();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
  try {
    await prisma.$transaction([
      prisma.emailChangeRequest.deleteMany({ where: { userId: user.id, usedAt: null } }),
      prisma.emailChangeRequest.create({
        data: { userId: user.id, newEmail, tokenHash: sha256(token), expiresAt },
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }

  const url = `${appBaseUrl()}/account/email/verify?token=${encodeURIComponent(token)}`;
  const status = await deliverMail({
    to: newEmail,
    subject: "メールアドレス変更の確認",
    body: `${user.name} さん\n\n次のリンクを開くとメールアドレスの変更が完了します。このリンクは24時間で無効になります。\n心当たりがないときは、リンクを開かずにこのメールを破棄してください。\n${url}\n`,
  });
  if (status === "RECORDED") console.info(`[mail] email change for ${newEmail}: ${url}`);
  return { maskedEmail: maskEmail(newEmail), expiresAt: expiresAt.toISOString() };
}

/**
 * 新しいアドレスの確認リンクを開いたときの確定処理。
 * メールは別端末で開くことがあるので、ログインセッションは必須にしない。
 * セッションは全件失効させる。呼び出し側は、本人のセッションが残っていれば JWT を発行し直す。
 */
export async function confirmEmailChange(token: string): Promise<{ userId: string; email: string }> {
  const row = await prisma.emailChangeRequest.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, deletedAt: true } } },
  });
  if (!row || row.usedAt || row.expiresAt <= new Date() || row.user.deletedAt) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "確認リンクが無効か、期限が切れています。もう一度変更をやり直してください。",
    });
  }
  const taken = await prisma.user.findFirst({
    where: { email: row.newEmail, NOT: { id: row.userId } },
    select: { id: true },
  });
  if (taken) throw emailTaken();

  await prisma.$transaction(async (tx) => {
    const marked = await tx.emailChangeRequest.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (marked.count !== 1) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "この確認リンクは既に使われています。",
      });
    }
    await tx.user.update({
      where: { id: row.userId },
      data: { email: row.newEmail, emailVerifiedAt: new Date() },
    });
    await recordAccountChange(tx, {
      userId: row.userId,
      kind: "EMAIL",
      beforeValue: null,
      afterValue: maskEmail(row.newEmail),
    });
    // メールを変えたら、他の端末のログインを切る。今の端末は呼び出し側で発行し直す。
    await tx.authSession.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  return { userId: row.userId, email: row.newEmail };
}

/** 退会。論理削除して、確認済みの電話番号だけは再登録の突き合わせのために残す。 */
export async function withdrawAccount(input: {
  userId: string;
  ipHash: string | null;
  cancelSubscription: (subscriptionId: string) => Promise<void>;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      platformRole: true,
      deletedAt: true,
      quota: { select: { stripeSubscriptionId: true, subscriptionStatus: true } },
    },
  });
  if (!user || user.deletedAt) throw userNotFound();
  if (user.platformRole === "ADMIN") {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "管理者アカウントは退会できません。先に管理者権限を外してください。",
      error: "ADMIN_CANNOT_WITHDRAW",
    });
  }

  // Stripe の解約に失敗したら退会を進めない（利用中の契約を宙に浮かせない）。
  const subscriptionId = user.quota?.stripeSubscriptionId ?? null;
  if (subscriptionId && user.quota?.subscriptionStatus !== "CANCELED") {
    try {
      await input.cancelSubscription(subscriptionId);
    } catch (error) {
      console.error("stripe subscription cancel failed", error);
      throw new ProblemDetailException({
        status: 502,
        title: "Bad Gateway",
        detail: "サブスクリプションの解約に失敗しました。時間をおいて再度お試しください。",
        error: "SUBSCRIPTION_CANCEL_FAILED",
      });
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // 筆頭幹事のイベントだけ閉じる。共同幹事として参加しているだけのイベントは残す。
    await tx.event.updateMany({
      where: { isDeleted: false, organizers: { some: { userId: input.userId, role: "OWNER" } } },
      data: { isDeleted: true, status: "CLOSED" },
    });
    await tx.eventOrganizer.deleteMany({ where: { userId: input.userId, role: "CO_HOST" } });

    // 電話番号は残す。同じ番号で再登録すると、この行と利用枠を引き継ぐ。
    await tx.user.update({
      where: { id: input.userId },
      data: {
        deletedAt: now,
        name: WITHDRAWN_NAME,
        email: anonymizedEmail(input.userId),
        emailVerifiedAt: null,
        passwordHash: null,
        googleSub: null,
      },
    });
    await tx.userUsageQuota.updateMany({
      where: { userId: input.userId, stripeSubscriptionId: subscriptionId },
      data: {
        stripeSubscriptionId: null,
        subscriptionStatus: "CANCELED",
        currentPeriodEnd: null,
        discountEndsAt: null,
        discountPercent: null,
        pricingCampaignId: null,
      },
    });
    await tx.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.emailChangeRequest.deleteMany({ where: { userId: input.userId } });
    await tx.phoneVerificationCode.deleteMany({ where: { userId: input.userId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId: input.userId } });
    await tx.loginChallenge.deleteMany({ where: { userId: input.userId, usedAt: null } });
    await recordAccountChange(tx, {
      userId: input.userId,
      kind: "WITHDRAW",
      ipHash: input.ipHash,
    });
  });
}
