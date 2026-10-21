import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { appBaseUrl } from "@/lib/http";
import { deliverMail } from "@/lib/mail";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

export type EmailConfirmResult =
  | { ok: false }
  | { ok: true; next: "login" }
  | { ok: true; next: "phone"; intentId: string };

export const VERIFICATION_NOTICE =
  "確認メールを送信しました。メールのリンクを開いてください。届かない場合は迷惑メールも確認してください。";

async function logIfUnsent(status: "SENT" | "RECORDED", line: string): Promise<void> {
  if (status === "RECORDED") console.info(`[mail] ${line}`);
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string }): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt },
    }),
  ]);
  const url = `${appBaseUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
  const status = await deliverMail({
    to: user.email,
    subject: "メールアドレスの確認",
    body: `${user.name} さん\n\n会員登録をリクエストした場合は、次のリンクを開いてください。このリンクは24時間で無効になります。\n心当たりがなければ、リンクは開かずにこのメールを破棄してください。\n${url}\n`,
  });
  await logIfUnsent(status, `verification link for ${user.email}: ${url}`);
}

export async function sendAlreadyRegisteredEmail(email: string): Promise<void> {
  const url = `${appBaseUrl()}/auth/register`;
  const status = await deliverMail({
    to: email,
    subject: "ログインのご案内",
    body: `このメールアドレスは登録済みです。パスワードでログインしてください。\n${url}\n`,
  });
  await logIfUnsent(status, `already registered notice for ${email}: ${url}`);
}

export async function beginSignupIntent(input: {
  email: string;
  name: string;
  passwordHash?: string | null;
  googleSub?: string | null;
  emailVerifiedAt?: Date | null;
  audience?: "ORGANIZER" | "PARTICIPANT";
}): Promise<{ id: string; email: string; name: string; audience: "ORGANIZER" | "PARTICIPANT" }> {
  await prisma.signupIntent.deleteMany({ where: { email: input.email } });
  return prisma.signupIntent.create({
    data: {
      email: input.email,
      name: input.name.slice(0, 50),
      passwordHash: input.passwordHash ?? null,
      googleSub: input.googleSub ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      audience: input.audience ?? "ORGANIZER",
      expiresAt: new Date(Date.now() + INTENT_TTL_MS),
    },
    select: { id: true, email: true, name: true, audience: true },
  });
}

/** 確認メールのリンク。参加者入口から始めた登録は、確認後の着地も参加者側へ寄せる。 */
function verificationUrl(token: string, audience: "ORGANIZER" | "PARTICIPANT"): string {
  const audienceQuery = audience === "PARTICIPANT" ? "&audience=participant" : "";
  return `${appBaseUrl()}/auth/verify?token=${encodeURIComponent(token)}${audienceQuery}`;
}

export async function sendIntentVerification(intent: {
  id: string;
  email: string;
  name: string;
  audience: "ORGANIZER" | "PARTICIPANT";
}): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { signupIntentId: intent.id, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: { signupIntentId: intent.id, tokenHash: sha256(token), expiresAt },
    }),
  ]);
  const url = verificationUrl(token, intent.audience);
  const status = await deliverMail({
    to: intent.email,
    subject: "メールアドレスの確認",
    body: `${intent.name} さん\n\n次のリンクを開くとメールアドレスの確認が完了します。このリンクは24時間で無効になります。\n${url}\n`,
  });
  await logIfUnsent(status, `verification link for ${intent.email}: ${url}`);
}

export async function confirmEmailToken(token: string): Promise<EmailConfirmResult> {
  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { signupIntent: true },
  });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return { ok: false };

  if (row.userId) {
    // 退会済みの会員のトークンは使わせない（退会時に削除するが、保険として確認する）。
    const owner = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { deletedAt: true },
    });
    if (!owner || owner.deletedAt) return { ok: false };
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      prisma.emailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);
    return { ok: true, next: "login" };
  }

  const intent = row.signupIntent;
  if (!intent || intent.expiresAt <= new Date()) return { ok: false };

  const user = await prisma.user.findUnique({ where: { email: intent.email } });
  if (user?.emailVerifiedAt && user.passwordHash) {
    await prisma.signupIntent.delete({ where: { id: intent.id } });
    return { ok: true, next: "login" };
  }
  if (user?.emailVerifiedAt && !user.passwordHash && intent.passwordHash) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: intent.passwordHash },
      }),
      prisma.signupIntent.delete({ where: { id: intent.id } }),
    ]);
    return { ok: true, next: "login" };
  }
  if (user && !user.emailVerifiedAt) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: new Date(),
          ...(intent.passwordHash && !user.passwordHash ? { passwordHash: intent.passwordHash } : {}),
        },
      }),
      prisma.signupIntent.delete({ where: { id: intent.id } }),
    ]);
    return { ok: true, next: "login" };
  }

  await prisma.$transaction([
    prisma.signupIntent.update({
      where: { id: intent.id },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);
  return { ok: true, next: "phone", intentId: intent.id };
}
