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

/** ??????????????????? */
let seq = 0;
function key(label: string): string {
  seq += 1;
  return `test-${process.pid}-${Date.now()}-${seq}-${label}`;
}

async function dropBuckets(buckets: string[]): Promise<void> {
  if (buckets.length === 0) return;
  await prisma.authAttempt.deleteMany({ where: { bucket: { in: buckets } } });
}

describeDb("????????", () => {
  const buckets: string[] = [];

  afterEach(async () => {
    await dropBuckets(buckets);
    buckets.length = 0;
  });

  it("???????????", async () => {
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
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("??????? 429 ?????????????", async () => {
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

  it("???????????", async () => {
    const k = key("under");
    buckets.push(bucketOf(rules.registerIp, k));
    await recordAuthAttempt(rules.registerIp, k);
    await expect(assertWithinAttemptLimit(rules.registerIp, k)).resolves.toBeUndefined();
  });

  it("????????????????", async () => {
    const a = key("a");
    const b = key("b");
    buckets.push(bucketOf(rules.loginEmail, a), bucketOf(rules.loginEmail, b));
    for (let i = 0; i < rules.loginEmail.limit; i += 1) {
      await recordAuthAttempt(rules.loginEmail, a);
    }
    const other = await attemptWindow(rules.loginEmail, b);
    expect(other.remainingAttempts).toBe(rules.loginEmail.limit);
  });

  it("????????????????", async () => {
    const k = key("clear");
    buckets.push(bucketOf(rules.loginEmail, k));
    await recordAuthAttempt(rules.loginEmail, k);
    await recordAuthAttempt(rules.loginEmail, k);
    await clearRuleAttempts(rules.loginEmail, k);
    const state = await attemptWindow(rules.loginEmail, k);
    expect(state.remainingAttempts).toBe(rules.loginEmail.limit);
  });

  it("???????????", async () => {
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

  it("env ?????????????", async () => {
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

describeDb("??????????????", () => {
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
        name: "????",
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

  it("?????????? CODE_EXHAUSTED ?????????", async () => {
    const phone = `+8190${String(Date.now()).slice(-8)}`;
    phones.push(phone);
    const user = await seedUser("phone");
    const ip = key("phone-ip");
    buckets.push(bucketOf(rules.phoneConfirmIp, ip));

    const code = "123456";
    await seedCode(user.id, phone, code);

    const attempt = (given: string) =>
      confirmPhoneVerification({ userId: user.id, intentId: null, phoneRaw: phone, code: given, ip });

    // ????????????????? 400?
    for (let i = 1; i < codeMaxAttempts; i += 1) {
      const error = await attempt("000000").catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ProblemDetailException);
      const problem = error as ProblemDetailException;
      expect(problem.status).toBe(400);
      expect(problem.extras.remainingAttempts).toBe(codeMaxAttempts - i);
      expect(problem.extras.attemptLimit).toBe(codeMaxAttempts);
      expect(problem.extras.error).toBeUndefined();
    }

    // ??? 1 ????????????
    const exhausted = await attempt("000000").catch((cause: unknown) => cause);
    expect(exhausted).toBeInstanceOf(ProblemDetailException);
    const problem = exhausted as ProblemDetailException;
    expect(problem.extras.error).toBe("CODE_EXHAUSTED");
    expect(problem.extras.remainingAttempts).toBe(0);

    // ???????????????????????
    const after = await attempt(code).catch((cause: unknown) => cause);
    expect((after as ProblemDetailException).extras.error).toBe("CODE_EXHAUSTED");
  });

  it("???????????????? IP ?????", async () => {
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
