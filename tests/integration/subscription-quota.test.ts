import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { SUBSCRIPTION_EVENT_LIMIT, jstMonthKey } from "@/modules/billing/lib/quota";
import { publishDraftEvent } from "@/modules/events/lib/events";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 前月のキー。月替わりで回数が戻ることを確かめるために使う。 */
function previousMonthKey(): string {
  const now = new Date();
  return jstMonthKey(new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000));
}

async function createUser(input: {
  plan: "MONTHLY_8" | "UNLIMITED";
  monthlyEventCount?: number;
  monthlyPeriodKey?: string | null;
  paidCredits?: number;
}) {
  return prisma.user.create({
    data: {
      email: uniqueEmail("subscription-quota"),
      name: "テスト会員",
      phoneVerifiedAt: new Date(),
      quota: {
        create: {
          freeEventCount: 0,
          paidCredits: input.paidCredits ?? 0,
          subscriptionStatus: "ACTIVE",
          subscriptionPlan: input.plan,
          monthlyEventCount: input.monthlyEventCount ?? 0,
          monthlyPeriodKey: input.monthlyPeriodKey ?? jstMonthKey(new Date()),
          currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    },
  });
}

async function publish(userId: string, draftId: string) {
  return publishDraftEvent(userId, draftId);
}

async function expectQuotaError(userId: string, draftId: string, code: string) {
  try {
    await publish(userId, draftId);
    throw new Error("例外が出ませんでした");
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemDetailException);
    const problem = error as ProblemDetailException;
    expect(problem.status).toBe(402);
    expect(problem.extras.error).toBe(code);
  }
}

describeDb("定額プランの回数（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("月8回プランは公開のたびに今月の回数を1つ増やす", async () => {
    const user = await createUser({ plan: "MONTHLY_8", monthlyEventCount: 7 });
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    await publish(user.id, draft.id);

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.monthlyEventCount).toBe(8);
    expect(quota.monthlyPeriodKey).toBe(jstMonthKey(new Date()));
    // 断定的な無料枠や単発クレジットは動かさない。
    expect(quota.freeEventCount).toBe(0);
    expect(quota.paidCredits).toBe(0);
  });

  it("8回に達したら 402 で止まり、作り放題を案内する", async () => {
    const user = await createUser({
      plan: "MONTHLY_8",
      monthlyEventCount: SUBSCRIPTION_EVENT_LIMIT,
    });
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    await expectQuotaError(user.id, draft.id, "MONTHLY_LIMIT_EXCEEDED");

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.monthlyEventCount).toBe(SUBSCRIPTION_EVENT_LIMIT);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: draft.id } });
    expect(event.status).toBe("DRAFT");
  });

  it("月が変われば、前月の回数は引き継がず 1 から数え直す", async () => {
    const user = await createUser({
      plan: "MONTHLY_8",
      monthlyEventCount: SUBSCRIPTION_EVENT_LIMIT,
      monthlyPeriodKey: previousMonthKey(),
    });
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    await publish(user.id, draft.id);

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.monthlyEventCount).toBe(1);
    expect(quota.monthlyPeriodKey).toBe(jstMonthKey(new Date()));
  });

  it("作り放題は回数を数えない", async () => {
    const user = await createUser({
      plan: "UNLIMITED",
      monthlyEventCount: SUBSCRIPTION_EVENT_LIMIT,
    });
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    await publish(user.id, draft.id);

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.monthlyEventCount).toBe(SUBSCRIPTION_EVENT_LIMIT);
    expect(quota.freeEventCount).toBe(0);
  });

  it("8回に達していても、単発クレジットがあればそちらを1つ使う", async () => {
    const user = await createUser({
      plan: "MONTHLY_8",
      monthlyEventCount: SUBSCRIPTION_EVENT_LIMIT,
      paidCredits: 1,
    });
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    await publish(user.id, draft.id);

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.paidCredits).toBe(0);
    expect(quota.monthlyEventCount).toBe(SUBSCRIPTION_EVENT_LIMIT);
  });
});
