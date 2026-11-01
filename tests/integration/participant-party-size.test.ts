import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  assertCapacityAllows,
  lockEventForCapacity,
  resolveAttendanceChoice,
  resolveStatusForCapacity,
  sumAttendingHeadcount,
} from "@/modules/events/lib/events";
import { cleanup, seedEvent } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 定員つきのイベントに、指定した人数の出席者を足す。 */
async function seedAttending(eventId: string, name: string, partySize: number) {
  return prisma.participant.create({
    data: {
      eventId,
      rsvpTokenHash: `${eventId}-${name}`,
      name,
      status: "ATTENDING",
      partySize,
    },
  });
}

describeDb("参加人数と定員（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("出席の人数は件数ではなく partySize の合計で数える", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await seedAttending(event.id, "ひとり", 1);
    await seedAttending(event.id, "家族", 3);

    expect(await sumAttendingHeadcount(prisma, event.id)).toBe(4);
    expect(await prisma.participant.count({ where: { eventId: event.id, status: "ATTENDING" } })).toBe(2);
  });

  it("人数ぶんで席が足りなければ参加要望へ読み替える", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 5 } });
    await seedAttending(event.id, "先着", 3);

    const fits = await prisma.$transaction(async (tx) => {
      await lockEventForCapacity(tx, event.id);
      return resolveStatusForCapacity(tx, event.id, { status: "ATTENDING", partySize: 2 });
    });
    expect(fits).toBe("ATTENDING");

    const overflow = await prisma.$transaction(async (tx) => {
      await lockEventForCapacity(tx, event.id);
      return resolveStatusForCapacity(tx, event.id, { status: "ATTENDING", partySize: 3 });
    });
    expect(overflow).toBe("WAITLISTED");
  });

  it("直す行の人数は数え直さない", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 3 } });
    const row = await seedAttending(event.id, "本人", 3);

    // 自分の 3 人を除けば 0 人なので、同じ 3 人のままでも通る。
    const status = await prisma.$transaction(async (tx) => {
      await lockEventForCapacity(tx, event.id);
      return resolveStatusForCapacity(tx, event.id, {
        status: "ATTENDING",
        partySize: 3,
        ignoreParticipantId: row.id,
      });
    });
    expect(status).toBe("ATTENDING");
  });

  it("承認で席が足りなければ 409 にする", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 2 } });
    await seedAttending(event.id, "先着", 2);

    await expect(
      prisma.$transaction(async (tx) => {
        await lockEventForCapacity(tx, event.id);
        await assertCapacityAllows(tx, event.id, { status: "ATTENDING", partySize: 1 });
      }),
    ).rejects.toMatchObject({ status: 409, extras: { error: "CAPACITY_REACHED" } });
  });
});

describeDb("複数日の出欠（結合）", () => {
  const eventIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds: [] });
    eventIds.length = 0;
  });

  it("選んだ全日を返し、代表はイベントの並び順で最初の日にする", async () => {
    const event = await seedEvent({
      scheduleDates: [
        new Date("2026-11-21T00:00:00.000Z"),
        new Date("2026-11-22T00:00:00.000Z"),
        new Date("2026-11-23T00:00:00.000Z"),
      ],
    });
    eventIds.push(event.id);
    const plan = await prisma.eventPricePlan.create({
      data: { eventId: event.id, name: "一般", audience: "ANY", amount: 3000, sortOrder: 0 },
    });
    const schedules = await prisma.eventSchedule.findMany({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });

    const choice = await prisma.$transaction((tx) =>
      resolveAttendanceChoice(tx, event.id, {
        status: "ATTENDING",
        pricePlanId: plan.id,
        scheduleIds: [schedules[2].id, schedules[0].id],
      }),
    );

    expect(choice.scheduleId).toBe(schedules[0].id);
    expect(choice.scheduleIds).toEqual([schedules[0].id, schedules[2].id]);
    expect(choice.priceAmount).toBe(3000);
  });

  it("イベントに無い日時が混ざれば 400 にする", async () => {
    const event = await seedEvent({
      scheduleDates: [new Date("2026-11-21T00:00:00.000Z")],
    });
    eventIds.push(event.id);
    const plan = await prisma.eventPricePlan.create({
      data: { eventId: event.id, name: "一般", audience: "ANY", amount: 3000, sortOrder: 0 },
    });

    await expect(
      prisma.$transaction((tx) =>
        resolveAttendanceChoice(tx, event.id, {
          status: "ATTENDING",
          pricePlanId: plan.id,
          scheduleIds: ["00000000-0000-4000-8000-000000000000"],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
