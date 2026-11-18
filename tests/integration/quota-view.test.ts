import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { loadQuotaView } from "@/modules/billing/lib/quota-view";
import { SUBSCRIPTION_PUBLISHED_EVENT_LIMIT } from "@/modules/billing/lib/quota";
import { DRAFT_EVENT_LIMIT_UNLIMITED } from "@/modules/billing/lib/plans";
import { GET as getQuota } from "@/app/api/v1/billing/quota/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function quotaRequest(token: string) {
  return new NextRequest("http://localhost/api/v1/billing/quota", {
    headers: { cookie: `auth_token=${token}` },
  });
}

/** クォータ行を持つ会員。公開の枠を 1 件使った状態から始める。 */
async function createMember() {
  return prisma.user.create({
    data: {
      email: uniqueEmail("quota-view"),
      name: "クォータの会員",
      phoneVerifiedAt: new Date(),
      quota: {
        create: {
          freeEventCount: 1,
          subscriptionStatus: "NONE",
          currentPeriodEnd: null,
        },
      },
    },
  });
}

/**
 * クォータの初期値（結合）。
 *
 * 画面の最初の HTML に載せる値と、`GET /api/v1/billing/quota` の応答が食い違わないことを見る。
 * 数え方を 2 か所に書き分けると、開いた直後に件数が変わる（帯が跳ねる）。
 */
describeDb("クォータの初期値（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("loadQuotaView は GET /api/v1/billing/quota と同じ応答を返す", async () => {
    const user = await createMember();
    userIds.push(user.id);

    // 公開 1 件・下書き 2 件。数え上げの条件がそろった状態で比べる。
    // 開催日は「今日以降」なら数えるので、実行日によらない未来日にする。
    const published = await seedEvent({
      userId: user.id,
      status: "PUBLISHED",
      scheduleDates: [new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)],
    });
    eventIds.push(published.id);
    for (const _ of [0, 1]) {
      const draft = await seedEvent({ userId: user.id, status: "DRAFT" });
      eventIds.push(draft.id);
    }
    const token = await signLocalToken({ userId: user.id, email: user.email });

    const seed = await loadQuotaView(user.id);
    const response = await getQuota(quotaRequest(token));
    const api = await response.json();

    expect(response.status).toBe(200);
    // 形も値も同じ。違いが出たら、どちらかの数え方がずれている。
    expect(api).toEqual(seed);
    expect(seed.publishedEventCount).toBe(1);
    expect(seed.draftEventCount).toBe(2);
    // 契約は変えない。会員ごとの値なので private、取り直しは 30 秒まで。
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=30");
  });

  it("クォータ行が無い会員は、API と同じく 404 QUOTA_NOT_FOUND で止まる", async () => {
    const user = await prisma.user.create({
      data: { email: uniqueEmail("quota-view-norow"), name: "行の無い会員" },
    });
    userIds.push(user.id);
    const token = await signLocalToken({ userId: user.id, email: user.email });

    await expect(loadQuotaView(user.id)).rejects.toMatchObject({ status: 404 });
    const response = await getQuota(quotaRequest(token));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("QUOTA_NOT_FOUND");
  });

  it("運営の付与中は、公開の枠・プラン・下書き 30 件・付与の印がそろう", async () => {
    const grantedAt = new Date("2026-11-01T00:00:00.000Z");
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail("quota-view-grant"),
        name: "付与された会員",
        phoneVerifiedAt: new Date(),
        quota: {
          create: {
            // 公開の枠は使い切っているが、付与中は件数を数えず、支払い状況も見ない。
            freeEventCount: 2,
            subscriptionStatus: "NONE",
            currentPeriodEnd: null,
            grantedPlan: "UNLIMITED",
            grantedPlanAt: grantedAt,
          },
        },
      },
    });
    userIds.push(user.id);
    // 8 件を超えて公開済みでも、付与中は公開中の件数を上限に寄せない。
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT + 1; index += 1) {
      const published = await seedEvent({
        userId: user.id,
        status: "PUBLISHED",
        quotaSource: "SUBSCRIPTION",
        scheduleDates: [new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)],
      });
      eventIds.push(published.id);
    }

    const view = await loadQuotaView(user.id);

    expect(view.canCreate).toBe(true);
    expect(view.planType).toBe("SUBSCRIPTION_UNLIMITED");
    expect(view.draftEventLimit).toBe(DRAFT_EVENT_LIMIT_UNLIMITED);
    expect(view.grantedUnlimited).toBe(true);
    expect(view.grantedAt).toBe(grantedAt.toISOString());
    // 8 件プランの残りは付与中には出さない（件数を数えない）。
    expect(view.remainingPublished).toBeNull();
  });
});
