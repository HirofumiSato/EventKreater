import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { SUBSCRIPTION_PUBLISHED_EVENT_LIMIT, jstToday } from "@/modules/billing/lib/quota";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { publishDraftEvent } from "@/modules/events/lib/events";
import { POST as cloneEvent } from "@/app/api/v1/organizer/events/[id]/clone/route";
import { POST as lifecycleEvent } from "@/app/api/v1/organizer/events/[id]/lifecycle/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 今日（JST）から days 日ずらした開催日。UTC 0 時の Date で作る。 */
function dayOffset(days: number): Date {
  return new Date(jstToday(new Date()).getTime() + days * DAY_MS);
}

async function createUser(input: {
  plan: "MONTHLY_8" | "UNLIMITED";
  paidCredits?: number;
  freeEventCount?: number;
}) {
  return prisma.user.create({
    data: {
      email: uniqueEmail("subscription-quota"),
      name: "テスト会員",
      phoneVerifiedAt: new Date(),
      quota: {
        create: {
          freeEventCount: input.freeEventCount ?? 0,
          paidCredits: input.paidCredits ?? 0,
          subscriptionStatus: "ACTIVE",
          subscriptionPlan: input.plan,
          currentPeriodEnd: new Date(Date.now() + 7 * DAY_MS),
        },
      },
    },
  });
}

interface PublishedOptions {
  status?: "PUBLISHED" | "CLOSED" | "DRAFT";
  isDeleted?: boolean;
  days?: number;
}

/** 公開中の件数に数えられる形のイベントを1件作る。 */
async function seedPublished(
  userId: string,
  options: PublishedOptions = {},
  eventIds: string[] = [],
) {
  const event = await seedEvent({
    userId,
    role: "OWNER",
    status: options.status ?? "PUBLISHED",
    isDeleted: options.isDeleted ?? false,
    quotaSource: "SUBSCRIPTION",
    scheduleDates: [dayOffset(options.days ?? 7)],
  });
  eventIds.push(event.id);
  return event;
}

async function seedDraft(userId: string, eventIds: string[]) {
  const draft = await seedEvent({ userId, role: "OWNER", status: "DRAFT" });
  eventIds.push(draft.id);
  return draft;
}

async function expectQuotaError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("例外が出ませんでした");
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemDetailException);
    const problem = error as ProblemDetailException;
    expect(problem.status).toBe(402);
    expect(problem.extras.error).toBe(code);
  }
}

async function quotaOf(userId: string) {
  return prisma.userUsageQuota.findUniqueOrThrow({ where: { userId } });
}

describeDb("公開中のイベント数（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("8件未満なら公開でき、公開したイベントは定額プランの枠として数える", async () => {
    const user = await createUser({ plan: "MONTHLY_8" });
    userIds.push(user.id);
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT - 1; index += 1) {
      await seedPublished(user.id, {}, eventIds);
    }
    const draft = await seedDraft(user.id, eventIds);

    const published = await publishDraftEvent(user.id, draft.id);

    expect(published.status).toBe("PUBLISHED");
    expect(published.quotaSource).toBe("SUBSCRIPTION");
    expect(published.quotaChargedAt).not.toBeNull();
    // 単発クレジットと無料枠は動かさない。
    const quota = await quotaOf(user.id);
    expect(quota.paidCredits).toBe(0);
    expect(quota.freeEventCount).toBe(0);
  });

  it("公開中が8件に達したら 402 で止まり、公開し放題を案内する", async () => {
    const user = await createUser({ plan: "MONTHLY_8" });
    userIds.push(user.id);
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT; index += 1) {
      await seedPublished(user.id, {}, eventIds);
    }
    const draft = await seedDraft(user.id, eventIds);

    await expectQuotaError(publishDraftEvent(user.id, draft.id), "PUBLISHED_EVENTS_FULL");

    const event = await prisma.event.findUniqueOrThrow({ where: { id: draft.id } });
    expect(event.status).toBe("DRAFT");
    expect(event.quotaChargedAt).toBeNull();
  });

  it("開催日が過ぎた・一時停止・削除済みは数えない", async () => {
    const user = await createUser({ plan: "MONTHLY_8" });
    userIds.push(user.id);
    // 数えるのは7件。数えないものをいくつ混ぜても、8件目は公開できる。
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT - 1; index += 1) {
      await seedPublished(user.id, {}, eventIds);
    }
    await seedPublished(user.id, { days: -1 }, eventIds);
    await seedPublished(user.id, { days: -30 }, eventIds);
    await seedPublished(user.id, { status: "CLOSED" }, eventIds);
    await seedPublished(user.id, { isDeleted: true }, eventIds);
    const draft = await seedDraft(user.id, eventIds);

    const published = await publishDraftEvent(user.id, draft.id);

    expect(published.status).toBe("PUBLISHED");
  });

  it("数えないイベントだけが8件あっても、公開中の件数は0のまま", async () => {
    const user = await createUser({ plan: "MONTHLY_8" });
    userIds.push(user.id);
    for (let index = 0; index < 4; index += 1) {
      await seedPublished(user.id, { days: -index - 1 }, eventIds);
    }
    for (let index = 0; index < 4; index += 1) {
      await seedPublished(user.id, { status: "CLOSED" }, eventIds);
    }
    const { countPublishedSubscriptionEvents } = await import("@/modules/billing/lib/quota");

    expect(await countPublishedSubscriptionEvents(prisma, user.id)).toBe(0);
  });

  it("8件に達していても、単発クレジットがあればそちらを1つ使って公開できる", async () => {
    const user = await createUser({ plan: "MONTHLY_8", paidCredits: 1 });
    userIds.push(user.id);
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT; index += 1) {
      await seedPublished(user.id, {}, eventIds);
    }
    const draft = await seedDraft(user.id, eventIds);

    const published = await publishDraftEvent(user.id, draft.id);

    expect(published.status).toBe("PUBLISHED");
    expect(published.quotaSource).toBe("PAID_CREDIT");
    expect((await quotaOf(user.id)).paidCredits).toBe(0);
  });

  it("公開し放題は件数を数えない", async () => {
    const user = await createUser({ plan: "UNLIMITED" });
    userIds.push(user.id);
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT + 2; index += 1) {
      await seedPublished(user.id, {}, eventIds);
    }
    const draft = await seedDraft(user.id, eventIds);

    const published = await publishDraftEvent(user.id, draft.id);

    expect(published.status).toBe("PUBLISHED");
    expect(published.quotaSource).toBe("SUBSCRIPTION");
    expect((await quotaOf(user.id)).paidCredits).toBe(0);
  });

  it("一時停止した催しの再開は、枠が空いていれば通り、満杯なら 402", async () => {
    const user = await createUser({ plan: "MONTHLY_8" });
    userIds.push(user.id);
    const token = await signLocalToken({ userId: user.id, email: user.email });
    const closed = await seedPublished(user.id, { status: "CLOSED" }, eventIds);

    // 数えるのは7件なので、再開して8件目にできる。
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT - 1; index += 1) {
      await seedPublished(user.id, {}, eventIds);
    }
    expect((await reopen(closed.id, token)).status).toBe(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: closed.id } })).status).toBe(
      "PUBLISHED",
    );

    // 8件に到達済み。9件目は無いので、別の一時停止を戻すと 402。
    const anotherClosed = await seedPublished(user.id, { status: "CLOSED" }, eventIds);
    const blocked = await reopen(anotherClosed.id, token);
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe("PUBLISHED_EVENTS_FULL");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: anotherClosed.id } })).status).toBe(
      "CLOSED",
    );
  });

  it("複製は下書きを作るだけで、枠を消費しない", async () => {
    const user = await createUser({ plan: "MONTHLY_8" });
    userIds.push(user.id);
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT; index += 1) {
      await seedPublished(user.id, {}, eventIds);
    }
    const source = await seedPublished(user.id, {}, eventIds);
    await prisma.eventPricePlan.create({
      data: { eventId: source.id, name: "一般", amount: 3000, sortOrder: 0 },
    });
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const cloned = await clone(source.id, token);

    expect(cloned.status).toBe(201);
    const created = await prisma.event.findUniqueOrThrow({
      where: { id: cloned.body.event.id },
      include: { schedules: true },
    });
    eventIds.push(created.id);
    expect(created.status).toBe("DRAFT");
    expect(created.quotaChargedAt).toBeNull();
    expect(created.quotaSource).toBeNull();
    expect(created.schedules).toHaveLength(1);
    expect((await quotaOf(user.id)).paidCredits).toBe(0);
  });
});

function lifecycleRequest(eventId: string, token: string, action: string) {
  return new NextRequest(`http://localhost/api/v1/organizer/events/${eventId}/lifecycle`, {
    method: "POST",
    headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

async function reopen(eventId: string, token: string) {
  const response = await lifecycleEvent(lifecycleRequest(eventId, token, "reopen"), {
    params: { id: eventId },
  });
  return { status: response.status, body: await response.json() };
}

async function clone(eventId: string, token: string) {
  const response = await cloneEvent(
    new NextRequest(`http://localhost/api/v1/organizer/events/${eventId}/clone`, {
      method: "POST",
      headers: { cookie: `auth_token=${token}` },
    }),
    { params: { id: eventId } },
  );
  return { status: response.status, body: await response.json() };
}
