import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { appBaseUrl } from "@/lib/http";
import { deliverMail, logRecordedMail } from "@/lib/mail";
import { ProblemDetailException } from "@/lib/exceptions";
import { passwordResetUrl } from "@/lib/auth-links";
import { hashPassword } from "@/modules/auth/lib/auth";
import { recordAccountChange } from "@/modules/account/lib/account";
import { assertPasswordNotBreached } from "@/modules/auth/lib/pwned";
import { assertWithinAttemptLimit, recordAuthAttempt } from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS } from "@/modules/auth/lib/rate-limits";

/** リンクの有効期限。短くして、漏れたリンクを使われる時間を減らす。 */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** 会員の有無・退会・管理者で変えない共通の応答。 */
export const RESET_NOTICE =
  "パスワード再設定のリンクを送信しました。メールのリンクを開いてください。";

function invalidResetToken(): ProblemDetailException {
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail: "このリンクは無効か、期限が切れています。もう一度リンクを送ってください。",
    error: "RESET_TOKEN_INVALID",
  });
}

/**
 * パスワード再設定のリンクを発行する。
 *
 * 該当なし・退会済み・管理者でも同じ応答を返し、メールだけを送らない。
 * 会員の有無を応答の違いから読み取られないようにするため。
 */
export async function requestPasswordReset(input: {
  email: string;
  audience: "organizer" | "participant";
  ip: string;
}): Promise<{ sent: true; detail: string }> {
  const { rules } = AUTH_RATE_LIMITS;
  const email = input.email.trim().toLowerCase();
  await assertWithinAttemptLimit(rules.resetEmail, email);
  await assertWithinAttemptLimit(rules.resetIp, input.ip);
  await recordAuthAttempt(rules.resetEmail, email);
  await recordAuthAttempt(rules.resetIp, input.ip);

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerifiedAt: true,
      platformRole: true,
    },
  });
  // 管理者はこの経路で再設定しない（管理コンソールは確認番号が必須）。
  if (!user || user.platformRole === "ADMIN") {
    return { sent: true, detail: RESET_NOTICE };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await prisma.$transaction([
    // 前のリンクを閉じてから作る。古いリンクを開いても無効になる。
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt },
    }),
  ]);

  const url = `${appBaseUrl()}${passwordResetUrl(input.audience, token)}`;
  const status = await deliverMail({
    to: user.email,
    subject: "パスワードの再設定",
    body: `${user.name} さん\n\nパスワードを再設定する場合は、次のリンクを開いてください。このリンクは30分で無効になります。\n心当たりがなければ、リンクは開かずにこのメールを破棄してください。\n${url}\n`,
  });
  if (status === "RECORDED") logRecordedMail(`password reset for ${user.email}: ${url}`);
  return { sent: true, detail: RESET_NOTICE };
}

/**
 * リンクを開いたあとの確定。パスワードを入れ替え、全セッションを失効させる。
 * メールは別端末で開くことがあるので、ログインセッションは必須にしない。
 */
export async function confirmPasswordReset(input: {
  token: string;
  newPassword: string;
  ip: string;
}): Promise<void> {
  const { rules } = AUTH_RATE_LIMITS;
  await assertWithinAttemptLimit(rules.resetConfirmIp, input.ip);
  await recordAuthAttempt(rules.resetConfirmIp, input.ip);

  if (input.newPassword.length < 8 || input.newPassword.length > 128) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "パスワードは8文字以上128文字以内にしてください。",
    });
  }

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(input.token) },
    include: { user: { select: { id: true, deletedAt: true, emailVerifiedAt: true } } },
  });
  if (!row || row.usedAt || row.expiresAt <= new Date() || row.user.deletedAt) {
    throw invalidResetToken();
  }

  await assertPasswordNotBreached(input.newPassword);
  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    // 先に使用済みにできた 1 回だけが確定する。二重送信はここで弾く。
    const marked = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (marked.count !== 1) throw invalidResetToken();

    await tx.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        // 未確認の会員も、リンクを開けたことをメール所有の証明として扱う。
        ...(row.user.emailVerifiedAt ? {} : { emailVerifiedAt: now }),
      },
    });
    // パスワードを変えたら、すべての端末のログインを切る。
    await tx.authSession.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await recordAccountChange(tx, {
      userId: row.userId,
      kind: "PASSWORD",
      ipHash: sha256(input.ip),
    });
  });
}
