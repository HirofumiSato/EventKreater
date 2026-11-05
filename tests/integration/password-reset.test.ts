import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { hashPassword, passwordMatches } from "@/modules/auth/lib/auth";
import { bucketOf } from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS } from "@/modules/auth/lib/rate-limits";
import {
  PASSWORD_RESET_TTL_MS,
  RESET_NOTICE,
  confirmPasswordReset,
  requestPasswordReset,
} from "@/modules/auth/lib/password-reset";
import { uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const { rules } = AUTH_RATE_LIMITS;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 確認前のパスワード。変わったことを見るために、確定後の値と分けておく。 */
const OLD_PASSWORD = "before-pass-123";
const NEW_PASSWORD = "after-pass-456";

/** テストごとに衝突しないバケットの鍵を作る。 */
let seq = 0;
function key(label: string): string {
  seq += 1;
  return `test-${process.pid}-${Date.now()}-${seq}-${label}`;
}

/** メール送信の本文から、リンクのトークンを取り出すために溜める。 */
interface CapturedMail {
  to: string;
  subject: string;
  body: string;
}

const mails: CapturedMail[] = [];

/**
 * 外部への `fetch` を止める。
 *
 * `deliverMail` は `MAIL_WEBHOOK_URL` があると送信するので、その宛先だけを受け取って
 * 本文を控える。`assertPasswordNotBreached` の pwned API は、流出なしの空の 200 を返す。
 */
function stubExternalServices(): void {
  vi.stubEnv("MAIL_WEBHOOK_URL", "https://mail.example.invalid/hook");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // pwnedpasswords は「流出なし」。本文が空なら該当なしで通る。
      if (url.startsWith("https://api.pwnedpasswords.com/")) return new Response("", { status: 200 });
      mails.push(JSON.parse(String(init?.body ?? "{}")) as CapturedMail);
      return new Response("", { status: 200 });
    }),
  );
}

/** 最後に送ったメール本文のリンクから、平文のトークンを取り出す。 */
function latestToken(): string {
  const body = mails.at(-1)?.body ?? "";
  const match = body.match(/[?&]token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`メール本文にトークンがありません: ${body}`);
  return match[1];
}

describeDb("パスワード再設定（結合）", () => {
  const userIds: string[] = [];
  const buckets: string[] = [];

  beforeEach(() => {
    stubExternalServices();
  });

  afterEach(async () => {
    // 監査ログは会員を消すと userId が NULL で残るので、先に消す。
    if (userIds.length > 0) {
      await prisma.accountChangeLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      userIds.length = 0;
    }
    if (buckets.length > 0) await prisma.authAttempt.deleteMany({ where: { bucket: { in: buckets } } });
    buckets.length = 0;
    mails.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function seedUser(
    prefix: string,
    options: {
      platformRole?: "MEMBER" | "ADMIN";
      deletedAt?: Date | null;
      emailVerifiedAt?: Date | null;
    } = {},
  ) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(prefix),
        name: "再設定の会員",
        platformRole: options.platformRole ?? "MEMBER",
        deletedAt: options.deletedAt ?? null,
        emailVerifiedAt: options.emailVerifiedAt === undefined ? new Date() : options.emailVerifiedAt,
        passwordHash: await hashPassword(OLD_PASSWORD),
      },
    });
    userIds.push(user.id);
    return user;
  }

  /** 発行を呼び、使ったバケットを片付けの対象に入れる。 */
  async function requestReset(
    email: string,
    ip: string,
    audience: "organizer" | "participant" = "organizer",
  ): Promise<{ sent: true; detail: string }> {
    buckets.push(
      bucketOf(rules.resetEmail, email.trim().toLowerCase()),
      bucketOf(rules.resetIp, ip),
    );
    return requestPasswordReset({ email, audience, ip });
  }

  /** 確定を呼び、使ったバケットを片付けの対象に入れる。 */
  async function confirmReset(token: string, newPassword: string, ip: string): Promise<void> {
    buckets.push(bucketOf(rules.resetConfirmIp, ip));
    await confirmPasswordReset({ token, newPassword, ip });
  }

  async function expectInvalidToken(promise: Promise<unknown>): Promise<ProblemDetailException> {
    const error = await promise.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProblemDetailException);
    const problem = error as ProblemDetailException;
    expect(problem.status).toBe(400);
    expect(problem.extras.error).toBe("RESET_TOKEN_INVALID");
    return problem;
  }

  it("該当なし・退会済み・管理者ではトークンを作らず、応答は同じ", async () => {
    const missing = await requestReset(uniqueEmail("reset-missing"), key("missing-ip"));

    const withdrawn = await seedUser("reset-withdrawn", { deletedAt: new Date() });
    const withdrawnResult = await requestReset(withdrawn.email, key("withdrawn-ip"));

    const admin = await seedUser("reset-admin", { platformRole: "ADMIN" });
    const adminResult = await requestReset(admin.email, key("admin-ip"));

    // どれも同じ文面。会員の有無を応答から読み取れない。
    expect(missing).toEqual({ sent: true, detail: RESET_NOTICE });
    expect(withdrawnResult).toEqual(missing);
    expect(adminResult).toEqual(missing);

    expect(
      await prisma.passwordResetToken.count({ where: { userId: { in: [withdrawn.id, admin.id] } } }),
    ).toBe(0);
    // メールも送らない。
    expect(mails).toHaveLength(0);
  });

  it("発行し直すと前のリンクは無効になり、新しいリンクだけが使える", async () => {
    const user = await seedUser("reset-reissue");
    await requestReset(user.email, key("reissue-ip-1"));
    const first = latestToken();

    await requestReset(user.email, key("reissue-ip-2"));
    const second = latestToken();
    expect(second).not.toBe(first);

    // 前の行は消え、未使用のトークンは 1 本だけ。期限は 30 分。
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(second));
    expect(rows[0].usedAt).toBeNull();
    // DB と Node の時計のずれぶんだけ緩めて、30 分であることを見る。
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(PASSWORD_RESET_TTL_MS + 60 * 1000);
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(PASSWORD_RESET_TTL_MS - 60 * 1000);

    // 古いリンクを開いても通らない。
    await expectInvalidToken(confirmReset(first, NEW_PASSWORD, key("reissue-confirm-ip-1")));

    // 新しいリンクはまだ使える。
    await confirmReset(second, NEW_PASSWORD, key("reissue-confirm-ip-2"));
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await passwordMatches(NEW_PASSWORD, stored.passwordHash)).toBe(true);
  });

  it("期限切れのリンクは RESET_TOKEN_INVALID の 400 になる", async () => {
    const user = await seedUser("reset-expired");
    const token = "expired-token-value-0123456789";
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expectInvalidToken(confirmReset(token, NEW_PASSWORD, key("expired-ip")));

    // パスワードは変わらない。
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await passwordMatches(OLD_PASSWORD, stored.passwordHash)).toBe(true);
  });

  it("使用済みのリンクは 2 回目から RESET_TOKEN_INVALID の 400 になる", async () => {
    const user = await seedUser("reset-used");
    await requestReset(user.email, key("used-ip"));
    const token = latestToken();

    await confirmReset(token, NEW_PASSWORD, key("used-confirm-ip-1"));

    const problem = await expectInvalidToken(confirmReset(token, "third-pass-789", key("used-confirm-ip-2")));
    expect(problem.detail).toContain("無効");

    // 2 回目のパスワードは入らない。
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await passwordMatches(NEW_PASSWORD, stored.passwordHash)).toBe(true);
    expect(await passwordMatches("third-pass-789", stored.passwordHash)).toBe(false);
  });

  it("成功でパスワードが変わり、全セッションが失効し、PASSWORD の記録が残る", async () => {
    const user = await seedUser("reset-success");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const sessions = await Promise.all(
      [0, 1].map(() =>
        prisma.authSession.create({
          data: { userId: user.id, expiresAt: new Date(Date.now() + DAY_MS) },
        }),
      ),
    );

    await requestReset(user.email, key("success-ip"));
    const token = latestToken();
    const confirmIp = key("success-confirm-ip");
    await confirmReset(token, NEW_PASSWORD, confirmIp);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).not.toBe(before.passwordHash);
    expect(await passwordMatches(NEW_PASSWORD, stored.passwordHash)).toBe(true);
    expect(await passwordMatches(OLD_PASSWORD, stored.passwordHash)).toBe(false);

    const revoked = await prisma.authSession.findMany({ where: { id: { in: sessions.map((row) => row.id) } } });
    expect(revoked).toHaveLength(2);
    expect(revoked.every((row) => row.revokedAt !== null)).toBe(true);

    const logs = await prisma.accountChangeLog.findMany({
      where: { userId: user.id, kind: "PASSWORD" },
    });
    expect(logs).toHaveLength(1);
    // 生の IP は残さず、ハッシュだけを入れる。
    expect(logs[0].ipHash).toBe(sha256(confirmIp));

    const used = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(used.usedAt).not.toBeNull();
  });

  it("メール未確認の会員は、確定時に emailVerifiedAt も埋まる", async () => {
    const user = await seedUser("reset-unverified", { emailVerifiedAt: null });
    await requestReset(user.email, key("unverified-ip"));
    const token = latestToken();

    await confirmReset(token, NEW_PASSWORD, key("unverified-confirm-ip"));

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();
    expect(await passwordMatches(NEW_PASSWORD, stored.passwordHash)).toBe(true);
  });

  it("8 文字未満のパスワードは 400 で、リンクは使われないまま残る", async () => {
    const user = await seedUser("reset-short");
    await requestReset(user.email, key("short-ip"));
    const token = latestToken();

    const error = await confirmReset(token, "1234567", key("short-confirm-ip")).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ProblemDetailException);
    const problem = error as ProblemDetailException;
    expect(problem.status).toBe(400);
    expect(problem.detail).toContain("8文字以上");

    // 弾いただけなので、リンクは未使用のまま。正しいパスワードなら通る。
    const row = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    expect(row.usedAt).toBeNull();
    await confirmReset(token, NEW_PASSWORD, key("short-confirm-ip"));
  });

  it("同じメールアドレスの送信を重ねると 429 になり、上限と再試行時刻を返す", async () => {
    const email = uniqueEmail("reset-limit");
    const ip = key("reset-limit-ip");

    for (let send = 0; send < rules.resetEmail.limit; send += 1) {
      await requestReset(email, ip);
    }

    const error = await requestReset(email, ip).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProblemDetailException);
    const problem = error as ProblemDetailException;
    expect(problem.status).toBe(429);
    expect(problem.extras.error).toBe("RATE_LIMITED");
    expect(problem.extras.limitLabel).toBe(rules.resetEmail.label);
    expect(problem.extras.attemptLimit).toBe(rules.resetEmail.limit);
    expect(problem.extras.remainingAttempts).toBe(0);
    expect(problem.extras.windowSeconds).toBe(HOUR_MS / 1000);
    expect(typeof problem.extras.retryAt).toBe("string");
  });
});