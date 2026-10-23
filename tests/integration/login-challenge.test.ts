import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { bucketOf } from "@/modules/auth/lib/rate-limit";
import { AUTH_RATE_LIMITS } from "@/modules/auth/lib/rate-limits";
import {
  startLoginChallenge,
  switchLoginChallengeChannel,
  type ChallengeUser,
} from "@/modules/auth/lib/login-challenge";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const { rules } = AUTH_RATE_LIMITS;

/** テストごとに衝突しないバケットの鍵を作る。 */
let seq = 0;
function key(label: string): string {
  seq += 1;
  return `test-${process.pid}-${Date.now()}-${seq}-${label}`;
}

/** チャレンジ Cookie を持つリクエスト。http なので `login_challenge` を使う。 */
function requestWith(challengeId: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/login-challenge", {
    headers: { cookie: `login_challenge=${challengeId}` },
  });
}

describeDb("ログイン確認番号の再送（結合）", () => {
  const userIds: string[] = [];
  const buckets: string[] = [];

  afterEach(async () => {
    if (userIds.length > 0) {
      await prisma.loginChallenge.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      userIds.length = 0;
    }
    if (buckets.length > 0) await prisma.authAttempt.deleteMany({ where: { bucket: { in: buckets } } });
    buckets.length = 0;
  });

  async function seedUser(prefix: string): Promise<ChallengeUser> {
    const phone = `+8190${String(Date.now()).slice(-8)}`;
    const user = await prisma.user.create({
      data: {
        email: `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`,
        name: "確認番号",
        phoneE164: phone,
        phoneVerifiedAt: new Date(),
      },
      select: { id: true, email: true, name: true, phoneE164: true, phoneVerifiedAt: true, platformRole: true },
    });
    userIds.push(user.id);
    return user;
  }

  function trackSmsBuckets(userId: string, ip: string): void {
    buckets.push(bucketOf(rules.loginSmsUser, userId), bucketOf(rules.loginSmsIp, ip));
  }

  it("同じ宛先へ送り直すと、前の確認番号は無効になり新しい番号だけが残る", async () => {
    const user = await seedUser("resend");
    const ip = key("resend-ip");
    trackSmsBuckets(user.id, ip);

    const started = await startLoginChallenge({ user, purpose: "PARTICIPANT", ip });
    expect(started.view.channel).toBe("SMS");
    expect(started.view.destinationMask).toContain("****");

    const resent = await switchLoginChallengeChannel({
      req: requestWith(started.id),
      channel: "SMS",
      ip,
    });

    expect(resent.id).not.toBe(started.id);
    expect(resent.view.channel).toBe("SMS");
    expect(resent.view.destinationMask).toBe(started.view.destinationMask);

    const previous = await prisma.loginChallenge.findUniqueOrThrow({ where: { id: started.id } });
    expect(previous.usedAt).not.toBeNull();

    const current = await prisma.loginChallenge.findUniqueOrThrow({ where: { id: resent.id } });
    expect(current.usedAt).toBeNull();
    expect(current.channel).toBe("SMS");
    expect(current.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("送信を重ねると上限に達し、上限と再試行時刻を返す", async () => {
    const user = await seedUser("resend-limit");
    const ip = key("resend-limit-ip");
    trackSmsBuckets(user.id, ip);

    let challenge = await startLoginChallenge({ user, purpose: "PARTICIPANT", ip });
    // 初回の送信で 1 回使っているので、上限まであと limit - 1 回。
    for (let send = 1; send < rules.loginSmsUser.limit; send += 1) {
      challenge = await switchLoginChallengeChannel({
        req: requestWith(challenge.id),
        channel: "SMS",
        ip,
      });
    }

    const error = await switchLoginChallengeChannel({
      req: requestWith(challenge.id),
      channel: "SMS",
      ip,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ProblemDetailException);
    const problem = error as ProblemDetailException;
    expect(problem.status).toBe(429);
    expect(problem.extras.error).toBe("RATE_LIMITED");
    expect(problem.extras.limitLabel).toBe(rules.loginSmsUser.label);
    expect(problem.extras.attemptLimit).toBe(rules.loginSmsUser.limit);
    expect(problem.extras.remainingAttempts).toBe(0);
    expect(typeof problem.extras.retryAt).toBe("string");
  });

  it("メールへ切り替えると、宛先のマスクと使える手段が変わる", async () => {
    const user = await seedUser("switch");
    const ip = key("switch-ip");
    trackSmsBuckets(user.id, ip);
    buckets.push(bucketOf(rules.loginEmailChallengeUser, user.id), bucketOf(rules.loginEmailChallengeIp, ip));

    const started = await startLoginChallenge({ user, purpose: "PARTICIPANT", ip });
    const switched = await switchLoginChallengeChannel({
      req: requestWith(started.id),
      channel: "EMAIL",
      ip,
    });

    expect(switched.view.channel).toBe("EMAIL");
    expect(switched.view.destinationMask).toContain("@");
    expect(switched.view.canUseSms).toBe(true);
    expect(switched.view.canUseEmail).toBe(true);
  });
});
