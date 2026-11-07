import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signLocalToken } from "@/modules/auth/lib/auth";
import {
  DRAFT_EVENT_LIMIT_FREE,
  DRAFT_EVENT_LIMIT_MONTHLY_8,
  DRAFT_EVENT_LIMIT_UNLIMITED,
} from "@/modules/billing/lib/plans";
import { FREE_EVENT_LIMIT, countDraftEvents } from "@/modules/billing/lib/quota";
import { POST as createEvent } from "@/app/api/v1/public/events/route";
import { POST as cloneEvent } from "@/app/api/v1/organizer/events/[id]/clone/route";
import { POST as saveDraft } from "@/app/api/v1/organizer/events/[id]/draft/route";
import { GET as getQuota } from "@/app/api/v1/billing/quota/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 作成画面が送る下書きの最小の入力。 */
const draftBody = {
  title: "下書きの催し",
  schedules: [{ eventDate: "2026-12-01", startTime: "19:00", endTime: "21:00" }],
  pricePlans: [{ name: "一般", audience: "ANY", amount: 3000, note: null }],
  venueName: "テスト会場",
  rainPolicy: "RAIN_OR_SHINE",
  capacity: null,
  flyerAssetId: null,
  rsvpDeadline: null,
  status: "DRAFT",
};

interface MemberOptions {
  plan?: "NONE" | "MONTHLY_8" | "UNLIMITED";
  freeEventCount?: number;
  phoneVerified?: boolean;
}

async function createUser(input: MemberOptions = {}) {
  const plan = input.plan ?? "NONE";
  return prisma.user.create({
    data: {
      email: uniqueEmail("draft-limit"),
      name: "下書きの会員",
      // 下書きは電話番号の確認を要らないが、公開の可否（canCreate）を見るために確認済みにする。
      phoneVerifiedAt: input.phoneVerified === false ? null : new Date(),
      quota: {
        create: {
          freeEventCount: input.freeEventCount ?? 0,
          subscriptionStatus: plan === "NONE" ? "NONE" : "ACTIVE",
          subscriptionPlan: plan,
          currentPeriodEnd: plan === "NONE" ? null : new Date(Date.now() + 7 * DAY_MS),
        },
      },
    },
  });
}

function createRequest(token: string, body: unknown) {
  return new NextRequest("http://localhost/api/v1/public/events", {
    method: "POST",
    headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cloneRequest(eventId: string, token: string) {
  return new NextRequest(`http://localhost/api/v1/organizer/events/${eventId}/clone`, {
    method: "POST",
    headers: { cookie: `auth_token=${token}` },
  });
}

function draftRequest(eventId: string, token: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/organizer/events/${eventId}/draft`, {
    method: "POST",
    headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function quotaRequest(token: string) {
  return new NextRequest("http://localhost/api/v1/billing/quota", {
    headers: { cookie: `auth_token=${token}` },
  });
}

describeDb("下書きの件数上限（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  async function member(input: MemberOptions = {}) {
    const created = await createUser(input);
    userIds.push(created.id);
    return created;
  }

  /** 下書きを count 件作り、作った ID を返す。 */
  async function seedDrafts(
    userId: string,
    count: number,
    options: { role?: "OWNER" | "CO_HOST"; scheduleDates?: Date[] } = {},
  ): Promise<string[]> {
    const created: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const event = await seedEvent({
        userId,
        role: options.role ?? "OWNER",
        status: "DRAFT",
        scheduleDates: options.scheduleDates,
      });
      eventIds.push(event.id);
      created.push(event.id);
    }
    return created;
  }

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("無料は3件までで、4件目は 403 DRAFT_LIMIT_REACHED になる", async () => {
    const user = await member();
    await seedDrafts(user.id, DRAFT_EVENT_LIMIT_FREE);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const response = await createEvent(createRequest(token, draftBody));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("DRAFT_LIMIT_REACHED");
    expect(body.detail).toContain(`下書きは${DRAFT_EVENT_LIMIT_FREE}件までです`);
    expect(body.draftLimit).toBe(DRAFT_EVENT_LIMIT_FREE);
    // 作られていない（3件のまま）。
    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_FREE);
  });

  it("980円は10件までで、11件目は 403 DRAFT_LIMIT_REACHED になる", async () => {
    const user = await member({ plan: "MONTHLY_8" });
    await seedDrafts(user.id, DRAFT_EVENT_LIMIT_MONTHLY_8);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const response = await createEvent(createRequest(token, draftBody));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("DRAFT_LIMIT_REACHED");
    expect(body.draftLimit).toBe(DRAFT_EVENT_LIMIT_MONTHLY_8);
    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_MONTHLY_8);
  });

  it("放題は30件までで、31件目は 403 DRAFT_LIMIT_REACHED になる", async () => {
    const user = await member({ plan: "UNLIMITED" });
    await seedDrafts(user.id, DRAFT_EVENT_LIMIT_UNLIMITED);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const response = await createEvent(createRequest(token, draftBody));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("DRAFT_LIMIT_REACHED");
    expect(body.draftLimit).toBe(DRAFT_EVENT_LIMIT_UNLIMITED);
    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_UNLIMITED);
  });

  it("共同主催だけの下書きは数えない", async () => {
    const user = await member();
    await seedDrafts(user.id, DRAFT_EVENT_LIMIT_FREE - 1);
    await seedDrafts(user.id, 3, { role: "CO_HOST" });
    const token = await signLocalToken({ userId: user.id, email: user.email });

    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_FREE - 1);

    // 共同主催だけの下書きは枠を食わないので、3件目はまだ作れる。
    const response = await createEvent(createRequest(token, draftBody));
    const body = await response.json();

    expect(response.status).toBe(201);
    eventIds.push(body.event.id);
    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_FREE);
  });

  it("開催日が過去の下書きも数える", async () => {
    const user = await member();
    await seedDrafts(user.id, DRAFT_EVENT_LIMIT_FREE - 1);
    await seedDrafts(user.id, 1, { scheduleDates: [new Date("2020-01-01T00:00:00.000Z")] });
    const token = await signLocalToken({ userId: user.id, email: user.email });

    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_FREE);

    // 過去日の1件も枠を食うので、4件目は作れない。
    const response = await createEvent(createRequest(token, draftBody));
    expect(response.status).toBe(403);
  });

  it("1件削除すると、また1件作れる", async () => {
    const user = await member();
    const drafts = await seedDrafts(user.id, DRAFT_EVENT_LIMIT_FREE);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    expect((await createEvent(createRequest(token, draftBody))).status).toBe(403);

    await prisma.event.delete({ where: { id: drafts[0] } });

    const response = await createEvent(createRequest(token, draftBody));
    const body = await response.json();
    expect(response.status).toBe(201);
    eventIds.push(body.event.id);
    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_FREE);
  });

  it("上限に達していても、既存の下書きの保存は通る", async () => {
    const user = await member();
    const drafts = await seedDrafts(user.id, DRAFT_EVENT_LIMIT_FREE);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const response = await saveDraft(
      draftRequest(drafts[0], token, { ...draftBody, title: "直した下書き" }),
      { params: { id: drafts[0] } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.event.title).toBe("直した下書き");
    const stored = await prisma.event.findUniqueOrThrow({ where: { id: drafts[0] } });
    expect(stored.status).toBe("DRAFT");
    // 保存は新しい下書きを作らないので、件数は上限のまま。
    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_FREE);
  });

  it("複製は下書きを1件増やすので、上限に達していると 403 DRAFT_LIMIT_REACHED", async () => {
    const user = await member();
    const source = await seedEvent({
      userId: user.id,
      role: "OWNER",
      status: "PUBLISHED",
      scheduleDates: [new Date("2026-12-01T00:00:00.000Z")],
    });
    eventIds.push(source.id);
    await prisma.eventPricePlan.create({
      data: { eventId: source.id, name: "一般", amount: 3000, sortOrder: 0 },
    });
    await seedDrafts(user.id, DRAFT_EVENT_LIMIT_FREE);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const response = await cloneEvent(cloneRequest(source.id, token), {
      params: { id: source.id },
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("DRAFT_LIMIT_REACHED");
    expect(await countDraftEvents(prisma, user.id)).toBe(DRAFT_EVENT_LIMIT_FREE);
  });

  it("GET /api/v1/billing/quota が下書きの件数と枠を返し、canCreate の意味は変えない", async () => {
    const user = await member();
    await seedDrafts(user.id, 2);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const first = await getQuota(quotaRequest(token));
    const firstBody = await first.json();
    expect(firstBody.draftEventCount).toBe(2);
    expect(firstBody.draftEventLimit).toBe(DRAFT_EVENT_LIMIT_FREE);
    expect(firstBody.remainingDrafts).toBe(1);
    expect(firstBody.canSaveDraft).toBe(true);
    // 公開の枠は別。無料の公開枠が残っているので canCreate は真のまま。
    expect(firstBody.canCreate).toBe(true);

    // 公開の枠を使い切ると canCreate は偽になるが、下書きの枠は減らない。
    await prisma.userUsageQuota.update({
      where: { userId: user.id },
      data: { freeEventCount: FREE_EVENT_LIMIT },
    });
    const secondBody = await (await getQuota(quotaRequest(token))).json();
    expect(secondBody.canCreate).toBe(false);
    expect(secondBody.canSaveDraft).toBe(true);

    // 下書きが上限に達すると canSaveDraft が偽になり、残りは 0 で止まる。
    await seedDrafts(user.id, 1);
    const thirdBody = await (await getQuota(quotaRequest(token))).json();
    expect(thirdBody.draftEventCount).toBe(DRAFT_EVENT_LIMIT_FREE);
    expect(thirdBody.remainingDrafts).toBe(0);
    expect(thirdBody.canSaveDraft).toBe(false);
  });
});
