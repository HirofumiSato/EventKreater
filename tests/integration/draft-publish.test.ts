import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { FREE_EVENT_LIMIT } from "@/modules/billing/lib/quota";
import { publishDraftEvent } from "@/modules/events/lib/events";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function createUser(freeEventCount = 0) {
  return prisma.user.create({
    data: {
      email: uniqueEmail("draft-publish"),
      name: "テスト会員",
      // 無料枠の消費には電話番号の確認が要る。課金判定だけを見たいので確認済みにする。
      phoneVerifiedAt: new Date(),
      quota: { create: { freeEventCount } },
    },
  });
}

describeDb("publishDraftEvent（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("未消費の下書きは、公開時に1回だけ枠を消費する", async () => {
    const user = await createUser(0);
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    const published = await publishDraftEvent(user.id, draft.id);

    expect(published.status).toBe("PUBLISHED");
    expect(published.quotaChargedAt).not.toBeNull();
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(1);
  });

  it("複製で消費済みの下書きは、公開しても二重に引かない", async () => {
    const user = await createUser(0);
    userIds.push(user.id);
    const draft = await seedEvent({
      userId: user.id,
      role: "OWNER",
      status: "DRAFT",
      quotaChargedAt: new Date(),
    });
    eventIds.push(draft.id);

    const published = await publishDraftEvent(user.id, draft.id);

    expect(published.status).toBe("PUBLISHED");
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(0);
  });

  it("二重公開は 409 で、枠を追加で消費しない", async () => {
    const user = await createUser(0);
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    await publishDraftEvent(user.id, draft.id);

    try {
      await publishDraftEvent(user.id, draft.id);
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      expect((error as ProblemDetailException).status).toBe(409);
    }
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(1);
  });

  it("枠を使い切っている未消費の下書きは 402", async () => {
    const user = await createUser(FREE_EVENT_LIMIT);
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    try {
      await publishDraftEvent(user.id, draft.id);
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      expect((error as ProblemDetailException).status).toBe(402);
    }
    const event = await prisma.event.findUniqueOrThrow({ where: { id: draft.id } });
    expect(event.status).toBe("DRAFT");
  });
});
