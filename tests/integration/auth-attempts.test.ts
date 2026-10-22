import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { sha256 } from "@/lib/crypto";
import { confirmPhoneVerification } from "@/modules/auth/lib/phone";
import {
  assertWithinAttemptLimit,
  attemptWindow,
  bucketOf,
  clearRuleAttempts,
  limitExtras,
  recordAuthAttempt,
  tighterLimit,
} from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS, createRateLimits } from "@/modules/auth/lib/rate-limits";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const { rules, codeMaxAttempts } = AUTH_RATE_LIMITS;

/** テストごとに衝突しないバケットを作る。 */
let seq = 0;
function key(label: string): string {
  seq += 1;
  return `test-${process.pid}-${Date.now()}-${seq}-${label}`;
}

async function dropBuckets(buckets: string[]): Promise<void> {
  if (buckets.length === 0) return;
  await prisma.authAttempt.deleteMany({ where: { bucket: { in: buckets } } });
}

describeDb("試行回数（結合）", () => {
  const buckets: string[] = [];

  afterEach(async () => {
    await dropBuckets(buckets);
    buckets.length = 0;
  });

  it("窓の外の試行は数えない", async () => {
    const k = key("outside");
    buckets.push(bucketOf(rules.loginEmail, k));
    await prisma.authAttempt.create({
      data: { bucket: bucketOf(rules.loginEmail, k), createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    await prisma.authAttempt.create({ data: { bucket: bucketOf(rules.loginEmail, k) } });

    const state = await attemptWindow(rules.loginEmail, k);
    expect(state.limit).toBe(rules.loginEmail.limit);
    expect(state.remainingAttempts).toBe(rules.loginEmail.limit - 1);
    expect(state.windowSeconds).toBe(15 * 60);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
    // 再試行までの秒数が、窓の長さを超えない。Retry-After と windowSeconds を食い違わせない。
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(rules.loginEmail.windowMs / 1000);
  });

  it("上限に達すると 429 を投げ、上限の情報を載せる", async () => {
    const k = key("limit");
    buckets.push(bucketOf(rules.registerIp, k));
    for (let i = 0; i < rules.registerIp.limit; i += 1) {
      await recordAuthAttempt(rules.registerIp, k);
    }

    const error = await assertWithinAttemptLimit(rules.registerIp, k).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProblemDetailException);
    const problem = error as ProblemDetailException;
    expect(problem.status).toBe(429);
    expect(problem.extras.error).toBe("RATE_LIMITED");
    expect(problem.extras.limitLabel).toBe(rules.registerIp.label);
    expect(problem.extras.attemptLimit).toBe(rules.registerIp.limit);
    expect(problem.extras.remainingAttempts).toBe(0);
    expect(problem.extras.windowSeconds).toBe(60 * 60);
    expect(typeof problem.extras.retryAfterSeconds).toBe("number");
    expect(typeof problem.extras.retryAt).toBe("string");
  });

  it("上限の手前なら投げない", async () => {
    const k = key("under");
    buckets.push(bucketOf(rules.registerIp, k));
    await recordAuthAttempt(rules.registerIp, k);
    await expect(assertWithinAttemptLimit(rules.registerIp, k)).resolves.toBeUndefined();
  });

  it("バケットが違えば互いに影響しない", async () => {
    const a = key("a");
    const b = key("b");
    buckets.push(bucketOf(rules.loginEmail, a), bucketOf(rules.loginEmail, b));
    for (let i = 0; i < rules.loginEmail.limit; i += 1) {
      await recordAuthAttempt(rules.loginEmail, a);
    }
    const other = await attemptWindow(rules.loginEmail, b);
    expect(other.remainingAttempts).toBe(rules.loginEmail.limit);
  });

  it("成功でバケットを消すと残りが戻る", async () => {
    const k = key("clear");
    buckets.push(bucketOf(rules.loginEmail, k));
    await recordAuthAttempt(rules.loginEmail, k);
    await recordAuthAttempt(rules.loginEmail, k);
    await clearRuleAttempts(rules.loginEmail, k);
    const state = await attemptWindow(rules.loginEmail, k);
    expect(state.remainingAttempts).toBe(rules.loginEmail.limit);
  });

  it("厳しいほうの上限を選ぶ", async () => {
    const email = key("tight-email");
    const ip = key("tight-ip");
    buckets.push(bucketOf(rules.loginEmail, email), bucketOf(rules.loginIp, ip));
    await recordAuthAttempt(rules.loginEmail, email);
    const tight = tighterLimit([
      [rules.loginEmail, await attemptWindow(rules.loginEmail, email)],
      [rules.loginIp, await attemptWindow(rules.loginIp, ip)],
    ]);
    expect(tight?.[0]).toBe(rules.loginEmail);
    expect(tight ? limitExtras(tight[0], tight[1]).limitLabel : null).toBe(rules.loginEmail.label);
  });

  it("env の上書きは窓の長さにも効く", async () => {
    const custom = createRateLimits({ NODE_ENV: "production", AUTH_ATTEMPT_WINDOW_MINUTES: "1" });
    const k = key("env");
    buckets.push(bucketOf(custom.rules.loginEmail, k));
    await prisma.authAttempt.create({
      data: { bucket: bucketOf(custom.rules.loginEmail, k), createdAt: new Date(Date.now() - 90 * 1000) },
    });
    const state = await attemptWindow(custom.rules.loginEmail, k);
    expect(state.remainingAttempts).toBe(custom.rules.loginEmail.limit);
  });
});

describeDb("電話番号の確認コード（結合）", () => {
  const userIds: string[] = [];
  const phones: string[] = [];
  const buckets: string[] = [];

  afterEach(async () => {
    await dropBuckets(buckets);
    buckets.length = 0;
    await prisma.phoneVerificationCode.deleteMany({ where: { phoneE164: { in: phones } } });
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    phones.length = 0;
  });

  async function seedUser(prefix: string) {
    const user = await prisma.user.create({
      data: {
        email: `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`,
        name: "電話確認",
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function seedCode(userId: string, phone: string, code: string) {
    const pepper = process.env.JWT_SECRET ?? "phone";
    await prisma.phoneVerificationCode.create({
      data: {
        phoneE164: phone,
        codeHash: sha256(`${pepper}:${phone}:${code}`),
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  }

  it("入力ミスを使い切ると CODE_EXHAUSTED になり、再送を促す", async () => {
    const phone = `+8190${String(Date.now()).slice(-8)}`;
    phones.push(phone);
    const user = await seedUser("phone");
    const ip = key("phone-ip");
    buckets.push(bucketOf(rules.phoneConfirmIp, ip));

    const code = "123456";
    await seedCode(user.id, phone, code);

    const attempt = (given: string) =>
      confirmPhoneVerification({ userId: user.id, intentId: null, phoneRaw: phone, code: given, ip });

    // 残りがあるあいだは、残り回数付きの 400。
    for (let i = 1; i < codeMaxAttempts; i += 1) {
      const error = await attempt("000000").catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ProblemDetailException);
      const problem = error as ProblemDetailException;
      expect(problem.status).toBe(400);
      expect(problem.extras.remainingAttempts).toBe(codeMaxAttempts - i);
      expect(problem.extras.attemptLimit).toBe(codeMaxAttempts);
      expect(problem.extras.error).toBeUndefined();
    }

    // 最後の 1 回でコードが無効になる。
    const exhausted = await attempt("000000").catch((cause: unknown) => cause);
    expect(exhausted).toBeInstanceOf(ProblemDetailException);
    const problem = exhausted as ProblemDetailException;
    expect(problem.extras.error).toBe("CODE_EXHAUSTED");
    expect(problem.extras.remainingAttempts).toBe(0);

    // 正しいコードでも、無効になったあとは通らない。
    const after = await attempt(code).catch((cause: unknown) => cause);
    expect((after as ProblemDetailException).extras.error).toBe("CODE_EXHAUSTED");
  });

  it("正しいコードは通り、照合の残りは IP 単位で減る", async () => {
    const phone = `+8180${String(Date.now()).slice(-8)}`;
    phones.push(phone);
    const user = await seedUser("phone-ok");
    const ip = key("phone-ok-ip");
    buckets.push(bucketOf(rules.phoneConfirmIp, ip));

    const code = "654321";
    await seedCode(user.id, phone, code);

    await expect(
      confirmPhoneVerification({ userId: user.id, intentId: null, phoneRaw: phone, code: "000000", ip }),
    ).rejects.toBeInstanceOf(ProblemDetailException);

    const result = await confirmPhoneVerification({
      userId: user.id,
      intentId: null,
      phoneRaw: phone,
      code,
      ip,
    });
    expect(result.user.id).toBe(user.id);

    const state = await attemptWindow(rules.phoneConfirmIp, ip);
    expect(state.remainingAttempts).toBe(rules.phoneConfirmIp.limit - 1);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.phoneE164).toBe(phone);
  });
});
