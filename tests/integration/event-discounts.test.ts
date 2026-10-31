import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { resolveDiscountChoice, syncEventOptions } from "@/modules/events/lib/events";
import { cleanup, seedEvent } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 割引だけを差し替えて保存する。日時と費用プランは前の状態を引き継ぐ。 */
async function saveDiscounts(
  eventId: string,
  discounts: { id?: string; name: string; amount: number; note: string | null }[],
) {
  const schedules = await prisma.eventSchedule.findMany({
    where: { eventId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, eventDate: true, startTime: true, endTime: true },
  });
  const plans = await prisma.eventPricePlan.findMany({
    where: { eventId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, audience: true, amount: true, note: true },
  });
  await prisma.$transaction((tx) =>
    syncEventOptions(tx, eventId, {
      // 日時が 1 件も無いと並び日の計算ができないので、既定の 1 件を置く。
      schedules:
        schedules.length > 0
          ? schedules.map((row) => ({
              id: row.id,
              eventDate: row.eventDate.toISOString().slice(0, 10),
              startTime: row.startTime ?? "18:00",
              endTime: row.endTime ?? "20:00",
            }))
          : [{ eventDate: "2026-12-01", startTime: "18:00", endTime: "20:00" }],
      pricePlans:
        plans.length > 0
          ? plans.map((row) => ({
              id: row.id,
              name: row.name,
              audience: row.audience,
              amount: row.amount,
              note: row.note,
            }))
          : [{ name: "一般", audience: "ANY" as const, amount: 3000, note: null }],
      discounts,
    }),
  );
}

describeDb("イベント割引（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("保存した割引は並び順つきで残り、参加者の写しは定義を消しても残る", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await saveDiscounts(event.id, [
      { name: "友達と参加", amount: 500, note: "2人以上のとき" },
      { name: "学生", amount: 300, note: null },
    ]);

    const discounts = await prisma.eventDiscount.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(discounts.map((row) => row.name)).toEqual(["友達と参加", "学生"]);

    const plan = await prisma.eventPricePlan.findFirstOrThrow({ where: { eventId: event.id } });
    const participant = await prisma.participant.create({
      data: {
        eventId: event.id,
        rsvpTokenHash: `hash-${event.id}`,
        name: "田中",
        status: "ATTENDING",
        pricePlanId: plan.id,
        priceAmount: plan.amount,
        pricePlanName: plan.name,
        priceAudience: plan.audience,
        discounts: {
          create: discounts.map((row, sortOrder) => ({
            discountId: row.id,
            name: row.name,
            amount: row.amount,
            note: row.note,
            sortOrder,
          })),
        },
      },
    });

    // 割引の定義を 0 件にして削除する。
    await saveDiscounts(event.id, []);
    expect(await prisma.eventDiscount.count({ where: { eventId: event.id } })).toBe(0);

    const snapshots = await prisma.participantDiscount.findMany({
      where: { participantId: participant.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(snapshots).toHaveLength(2);
    // 定義が消えたので discountId は SetNull になり、写しだけが残る。
    expect(snapshots[0]).toMatchObject({ discountId: null, name: "友達と参加", amount: 500 });
    expect(snapshots[1]).toMatchObject({ discountId: null, name: "学生", amount: 300 });
  });

  it("別のイベントの割引 ID を選ぶと 400", async () => {
    const event = await seedEvent();
    const other = await seedEvent();
    eventIds.push(event.id, other.id);
    await saveDiscounts(event.id, [{ name: "友達と参加", amount: 500, note: null }]);
    await saveDiscounts(other.id, [{ name: "別の割引", amount: 100, note: null }]);
    const foreign = await prisma.eventDiscount.findFirstOrThrow({ where: { eventId: other.id } });

    await expect(
      prisma.$transaction((tx) =>
        resolveDiscountChoice(tx, event.id, "ATTENDING", [foreign.id]),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("同じ ID は畳み、定義の並び順で写しを作る", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await saveDiscounts(event.id, [
      { name: "友達と参加", amount: 500, note: "2人以上のとき" },
      { name: "学生", amount: 300, note: null },
    ]);
    const saved = await prisma.eventDiscount.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });

    const chosen = await prisma.$transaction((tx) =>
      resolveDiscountChoice(tx, event.id, "ATTENDING", [
        saved[1].id,
        saved[1].id,
        saved[0].id,
      ]),
    );
    expect(chosen).toEqual([
      { discountId: saved[0].id, name: "友達と参加", amount: 500, note: "2人以上のとき" },
      { discountId: saved[1].id, name: "学生", amount: 300, note: null },
    ]);
  });

  it("出席でないときは割引を返さない（欠席・参加要望では消す）", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await saveDiscounts(event.id, [{ name: "友達と参加", amount: 500, note: null }]);
    const saved = await prisma.eventDiscount.findFirstOrThrow({ where: { eventId: event.id } });

    const declined = await prisma.$transaction((tx) =>
      resolveDiscountChoice(tx, event.id, "DECLINED", [saved.id]),
    );
    const waitlisted = await prisma.$transaction((tx) =>
      resolveDiscountChoice(tx, event.id, "WAITLISTED", [saved.id]),
    );
    expect(declined).toEqual([]);
    expect(waitlisted).toEqual([]);
  });
});
