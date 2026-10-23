import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { CreateEventSchema, SaveEventDraftSchema } from "@/lib/schemas";
import { FREE_EVENT_LIMIT } from "@/modules/billing/lib/quota";
import {
  createEventForUser,
  publishDraftEvent,
  saveEventDraft,
} from "@/modules/events/lib/events";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const baseInput = {
  title: "下書きの催し",
  schedules: [{ eventDate: "2026-12-01", startTime: "19:00", endTime: "21:00" }],
  pricePlans: [{ name: "一般", audience: "ANY" as const, amount: 3000, note: null }],
  venueName: "テスト会場",
  rainPolicy: "RAIN_OR_SHINE" as const,
  capacity: null,
  flyerAssetId: null,
  rsvpDeadline: null,
};

async function createUser(freeEventCount = 0) {
  return prisma.user.create({
    data: {
      email: uniqueEmail("draft-save"),
      name: "テスト会員",
      // 枠の消費には電話番号の確認が要る。保存と公開だけを見たいので確認済みにする。
      phoneVerifiedAt: new Date(),
      quota: { create: { freeEventCount } },
    },
  });
}

/**
 * 作成画面の「下書き保存」から「プレビュー」「公開」までの流れ。
 * 下書きは枠を消費せず、公開で1回だけ消費する。
 */
describeDb("下書きの保存と公開（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("下書き作成では枠を消費せず、公開で1回だけ消費する", async () => {
    const user = await createUser(0);
    userIds.push(user.id);

    const input = CreateEventSchema.parse({ ...baseInput, status: "DRAFT" });
    const created = await createEventForUser(user.id, input);
    eventIds.push(created.event.id);

    expect(created.event.status).toBe("DRAFT");
    expect(created.event.quotaChargedAt).toBeNull();
    let quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(0);

    const published = await publishDraftEvent(user.id, created.event.id);
    expect(published.status).toBe("PUBLISHED");
    quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(1);
  });

  it("下書きの上書き保存は状態を変えず、日時と費用プランだけを入れ替える", async () => {
    const user = await createUser(0);
    userIds.push(user.id);
    const draft = await seedEvent({ userId: user.id, status: "DRAFT" });
    eventIds.push(draft.id);

    const saved = await saveEventDraft(
      draft.id,
      SaveEventDraftSchema.parse({
        ...baseInput,
        title: "直した催し",
        schedules: [{ eventDate: "2026-12-20", startTime: "18:30", endTime: "20:30" }],
        pricePlans: [
          { name: "一般", audience: "ANY", amount: 4000, note: "1ドリンク付" },
          { name: "学生", audience: "ANY", amount: 2000, note: null },
        ],
        status: "DRAFT",
      }),
    );

    expect(saved.status).toBe("DRAFT");
    expect(saved.title).toBe("直した催し");
    expect(saved.location).toBe("テスト会場");
    expect(saved.sortDate.toISOString().slice(0, 10)).toBe("2026-12-20");

    const schedules = await prisma.eventSchedule.findMany({ where: { eventId: draft.id } });
    expect(schedules).toHaveLength(1);
    expect(schedules[0].startTime).toBe("18:30");
    const plans = await prisma.eventPricePlan.findMany({
      where: { eventId: draft.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(plans.map((row) => row.name)).toEqual(["一般", "学生"]);

    // 保存では枠を消費しない。
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(0);
  });

  it("枠を使い切った会員でも下書きは保存でき、公開で 402 になる", async () => {
    const user = await createUser(FREE_EVENT_LIMIT);
    userIds.push(user.id);

    const input = CreateEventSchema.parse({ ...baseInput, status: "DRAFT" });
    const created = await createEventForUser(user.id, input);
    eventIds.push(created.event.id);

    try {
      await publishDraftEvent(user.id, created.event.id);
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      expect((error as ProblemDetailException).status).toBe(402);
    }
    // 公開に失敗しても下書きのまま残る。
    const stored = await prisma.event.findUniqueOrThrow({ where: { id: created.event.id } });
    expect(stored.status).toBe("DRAFT");
  });

  it("公開済みの催しは下書きとして上書きできない（409）", async () => {
    const user = await createUser(0);
    userIds.push(user.id);
    const published = await seedEvent({ userId: user.id, status: "PUBLISHED" });
    eventIds.push(published.id);

    try {
      await saveEventDraft(published.id, SaveEventDraftSchema.parse(baseInput));
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      expect((error as ProblemDetailException).status).toBe(409);
    }
  });

  it("存在しない催しの下書き保存は 404", async () => {
    try {
      await saveEventDraft(
        "11111111-1111-4111-8111-111111111111",
        SaveEventDraftSchema.parse(baseInput),
      );
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      expect((error as ProblemDetailException).status).toBe(404);
    }
  });
});
