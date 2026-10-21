import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { passwordMatches } from "@/modules/auth/lib/auth";
import { confirmAccountChallenge } from "@/modules/auth/lib/login-challenge";

function userNotFound(): ProblemDetailException {
  return new ProblemDetailException({
    status: 404,
    title: "Not Found",
    detail: "会員が見つかりません。",
  });
}

export function passwordInvalid(): ProblemDetailException {
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail: "パスワードが正しくありません。",
    error: "PASSWORD_INVALID",
  });
}

export function reauthRequired(): ProblemDetailException {
  return new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail: "確認番号を入力してください。",
    error: "REAUTH_REQUIRED",
  });
}

/** 確認番号での本人確認だけを行う。メールアドレス変更のように、常にコードを求める操作で使う。 */
export async function verifyReauthCode(input: {
  req: NextRequest;
  code: string | undefined;
  ip: string;
}): Promise<void> {
  if (!input.code) throw reauthRequired();
  await confirmAccountChallenge({ req: input.req, code: input.code, ip: input.ip });
}

/**
 * 現在のパスワードで本人確認する。パスワードを持たない（Google のみの）会員は、
 * 代わりに確認番号を求める。
 */
export async function verifyPasswordOrCode(input: {
  req: NextRequest;
  userId: string;
  password: string | undefined;
  code: string | undefined;
  ip: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { passwordHash: true },
  });
  if (!user) throw userNotFound();
  if (user.passwordHash) {
    const ok = await passwordMatches(input.password ?? "", user.passwordHash);
    if (!ok) throw passwordInvalid();
    return;
  }
  await verifyReauthCode({ req: input.req, code: input.code, ip: input.ip });
}
