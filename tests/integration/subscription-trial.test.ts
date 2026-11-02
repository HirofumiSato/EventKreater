import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { deliverMail } from "@/lib/mail";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { publishDraftEvent } from "@/modules/events/lib/events";
import { resolveTrial, trialEndsAt } from "@/modules/billing/lib/trial";
import { sendFreePeriodEndingNotices } from "@/modules/billing/lib/notices";
import { GET as getQuota } from "@/app/api/v1/billing/quota/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

// 通知バッチの宛先と件数だけを見る。メールの送信自体は外部に出すので、ここで止める。
vi.mock("@/lib/mail", () => ({
  deliverMail: vi.fn(async () => "SENT" as const),
}));

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

interface CreateTrialUserInput {
  plan?: "MONTHLY_8" | "UNLIMITED";
  subscriptionStatus?: "NONE" | "ACTIVE";
  /** 初月無料の終了日時。未来なら trialing のあいだとみなす。 */
  trialEndsAt?: Date | null;
  /** 初月無料を使った印。再加入で繰り返さないための値。 */
  trialUsedAt?: Date | null;
  currentPeriodEnd?: Date | null;
  stripeSubscriptionId?: string | null;
}

async function createUser(input: CreateTrialUserInput = {}) {
  return prisma.user.create({
    data: {
      email: uniqueEmail("subscription-trial"),
      name: "テスト会員",
      phoneVerifiedAt: new Date(),
      quota: {
        create: {
          freeEventCount: 0,
          paidCredits: 0,
          subscriptionStatus: input.subscriptionStatus ?? "NONE",
          subscriptionPlan: input.plan ?? "NONE",
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          trialEndsAt: input.trialEndsAt ?? null,
          trialUsedAt: input.trialUsedAt ?? null,
          stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        },
      },
    },
  });
}

async function readQuota(token: string) {
  const response = await getQuota(
    new NextRequest("http://localhost/api/v1/billing/quota", {
      headers: { cookie: `auth_token=${token}` },
    }),
  );
  return { status: response.status, body: await response.json() };
}

describeDb("初月無料のチケット（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("trialing のあいだ（ACTIVE・trialEndsAt が未来）もイベントを公開できる", async () => {
    const end = new Date(Date.now() + 20 * DAY_MS);
    const user = await createUser({
      plan: "UNLIMITED",
      subscriptionStatus: "ACTIVE",
      trialEndsAt: end,
      trialUsedAt: new Date(),
      currentPeriodEnd: end,
      stripeSubscriptionId: "sub_trial_1",
    });
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    const published = await publishDraftEvent(user.id, draft.id);

    expect(published.status).toBe("PUBLISHED");
    expect(published.quotaSource).toBe("SUBSCRIPTION");
    // 初月無料でも無料チケットは減らない。
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(0);
    expect(quota.paidCredits).toBe(0);
    expect(quota.trialEndsAt?.toISOString()).toBe(end.toISOString());
  });

  it("初月無料を使った会員は、再加入しても対象外になる", async () => {
    const usedAt = new Date(Date.now() - 60 * DAY_MS);
    const user = await createUser({ trialUsedAt: usedAt });
    userIds.push(user.id);

    await expect(resolveTrial(user.id)).resolves.toEqual({ eligible: false, endsAt: null });
  });

  it("契約の記録が残る会員も対象外になる", async () => {
    // 解約で stripeSubscriptionId が消えても、支払済みの月額があれば再適用しない。
    const user = await createUser({});
    userIds.push(user.id);
    await prisma.billingTransaction.create({
      data: {
        userId: user.id,
        paymentType: "SUBSCRIPTION",
        paymentStatus: "SUCCEEDED",
        amount: 0,
        listAmount: 2980,
        discountAmount: 2980,
        trialApplied: true,
        currency: "jpy",
      },
    });

    await expect(resolveTrial(user.id)).resolves.toEqual({ eligible: false, endsAt: null });
  });

  it("はじめての月額加入なら、加入から1か月後を終了日時として返す", async () => {
    const user = await createUser({});
    userIds.push(user.id);
    const now = new Date("2026-11-02T09:00:00.000Z");

    await expect(resolveTrial(user.id, now)).resolves.toEqual({
      eligible: true,
      endsAt: trialEndsAt(now),
    });
  });

  it("GET /api/v1/billing/quota が無料期間と加入資格を返す", async () => {
    const end = new Date(Date.now() + 10 * DAY_MS);
    const trialing = await createUser({
      plan: "MONTHLY_8",
      subscriptionStatus: "ACTIVE",
      trialEndsAt: end,
      trialUsedAt: new Date(),
      currentPeriodEnd: end,
      stripeSubscriptionId: "sub_trial_2",
    });
    const fresh = await createUser({});
    userIds.push(trialing.id, fresh.id);

    const trialingBody = await readQuota(
      await signLocalToken({ userId: trialing.id, email: trialing.email }),
    );
    expect(trialingBody.status).toBe(200);
    expect(trialingBody.body.trial).toEqual({ endsAt: end.toISOString() });
    // 加入中は新しい初月無料を使えない。
    expect(trialingBody.body.trialEligible).toBe(false);
    expect(trialingBody.body.discount).toBeNull();

    const freshBody = await readQuota(
      await signLocalToken({ userId: fresh.id, email: fresh.email }),
    );
    expect(freshBody.status).toBe(200);
    expect(freshBody.body.trial).toBeNull();
    expect(freshBody.body.trialEligible).toBe(true);
  });
});

describeDb("初月無料の終了前通知（結合）", () => {
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds: [], userIds });
    userIds.length = 0;
    vi.mocked(deliverMail).mockClear();
  });

  it("trialEndsAt を拾い、3日前と1日前に1回ずつ送り、同じ periodEnd では再送しない", async () => {
    const end = new Date(Date.now() + 10 * DAY_MS);
    const user = await createUser({
      plan: "UNLIMITED",
      subscriptionStatus: "ACTIVE",
      trialEndsAt: end,
      trialUsedAt: new Date(),
      currentPeriodEnd: end,
      stripeSubscriptionId: "sub_trial_notice",
    });
    userIds.push(user.id);

    const threeDaysBefore = new Date(end.getTime() - 2.5 * DAY_MS);
    const oneDayBefore = new Date(end.getTime() - 12 * 60 * 60 * 1000);

    const first = await sendFreePeriodEndingNotices(threeDaysBefore);
    const firstNotices = first.notices.filter((notice) => notice.userId === user.id);
    expect(firstNotices).toHaveLength(1);
    expect(firstNotices[0].kind).toBe("FREE_PERIOD_ENDING_3D");
    expect(firstNotices[0].periodEnd).toBe(end.toISOString());

    const second = await sendFreePeriodEndingNotices(oneDayBefore);
    const secondNotices = second.notices.filter((notice) => notice.userId === user.id);
    expect(secondNotices).toHaveLength(1);
    expect(secondNotices[0].kind).toBe("FREE_PERIOD_ENDING_1D");
    expect(secondNotices[0].periodEnd).toBe(end.toISOString());

    // 同じ periodEnd・同じ種別では、もう送らない。
    const again = await sendFreePeriodEndingNotices(oneDayBefore);
    const againNotices = again.notices.filter((notice) => notice.userId === user.id);
    expect(againNotices).toHaveLength(1);
    expect(againNotices[0].status).toBe("SKIPPED");

    const rows = await prisma.billingNotice.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "FREE_PERIOD_ENDING_1D",
      "FREE_PERIOD_ENDING_3D",
    ]);
    expect(rows.every((row) => row.periodEnd.getTime() === end.getTime())).toBe(true);
    // 無料期間はクーポンではないので、キャンペーンには紐づけない。
    expect(rows.every((row) => row.campaignId === null)).toBe(true);

    const sentToUser = vi
      .mocked(deliverMail)
      .mock.calls.filter(([message]) => message.to === user.email);
    expect(sentToUser).toHaveLength(2);
    expect(sentToUser[0][0].subject).toContain("無料期間");
  });
});
