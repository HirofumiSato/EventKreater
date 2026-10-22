import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  lockEventForCapacity,
  resolveStatusForCapacity,
} from "@/modules/events/lib/events";
import { waitlistPosition } from "@/modules/events/lib/rsvp-status";
import { cleanup, seedEvent } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 定員つきのイベントに、指定した出欠の参加者を足す。 */
async function seedParticipant(
  eventId: string,
  status: "ATTENDING" | "DECLINED" | "WAITLISTED",
  name: string,
  waitlistedAt: Date | null = null,
) {
  return prisma.participant.create({
    data: {
      eventId,
      rsvpTokenHash: `${eventId}-${name}`,
      name,
      status,
      waitlistedAt,
    },
  });
}

describeDb("参加要望（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("空きがあれば出席のまま通す", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 2 } });
    await seedParticipant(event.id, "ATTENDING", "先着");

    const status = await prisma.$transaction(async (tx) => {
      await lockEventForCapacity(tx, event.id);
      return resolveStatusForCapacity(tx, event.id, "ATTENDING");
    });
    expect(status).toBe("ATTENDING");
  });

  it("定員に達していたら出席を参加要望へ読み替える", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 1 } });
    await seedParticipant(event.id, "ATTENDING", "先着");

    const status = await prisma.$transaction(async (tx) => {
      await lockEventForCapacity(tx, event.id);
      return resolveStatusForCapacity(tx, event.id, "ATTENDING");
    });
    expect(status).toBe("WAITLISTED");
  });

  it("欠席は満員でも欠席のまま", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 1 } });
    await seedParticipant(event.id, "ATTENDING", "先着");

    const status = await prisma.$transaction(async (tx) => {
      await lockEventForCapacity(tx, event.id);
      return resolveStatusForCapacity(tx, event.id, "DECLINED");
    });
    expect(status).toBe("DECLINED");
  });

  it("定員が無ければ満員にならない", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await seedParticipant(event.id, "ATTENDING", "一人目");
    await seedParticipant(event.id, "ATTENDING", "二人目");

    const status = await prisma.$transaction(async (tx) => {
      await lockEventForCapacity(tx, event.id);
      return resolveStatusForCapacity(tx, event.id, "ATTENDING");
    });
    expect(status).toBe("ATTENDING");
  });

  it("行ロックで直列化され、最後の1席は1人しか取れない", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 1 } });

    const attempt = (name: string) =>
      prisma.$transaction(async (tx) => {
        await lockEventForCapacity(tx, event.id);
        const status = await resolveStatusForCapacity(tx, event.id, "ATTENDING");
        await tx.participant.create({
          data: {
            eventId: event.id,
            rsvpTokenHash: `${event.id}-${name}`,
            name,
            status,
            waitlistedAt: status === "WAITLISTED" ? new Date() : null,
          },
        });
        return status;
      });

    const results = await Promise.all([attempt("同時A"), attempt("同時B")]);
    expect(results.filter((status) => status === "ATTENDING")).toHaveLength(1);
    expect(results.filter((status) => status === "WAITLISTED")).toHaveLength(1);

    const attending = await prisma.participant.count({
      where: { eventId: event.id, status: "ATTENDING" },
    });
    expect(attending).toBe(1);
  });

  it("待ち順は要望日時の古い順で、承認すると順位から外れる", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);

    const first = await seedParticipant(
      event.id,
      "WAITLISTED",
      "早い",
      new Date("2026-10-22T01:00:00.000Z"),
    );
    const second = await seedParticipant(
      event.id,
      "WAITLISTED",
      "遅い",
      new Date("2026-10-22T02:00:00.000Z"),
    );
    const attending = await seedParticipant(event.id, "ATTENDING", "出席者");

    const rows = await prisma.participant.findMany({
      where: { eventId: event.id, status: "WAITLISTED" },
      select: { id: true, status: true, waitlistedAt: true, createdAt: true },
    });
    expect(waitlistPosition(rows, first.id)).toBe(1);
    expect(waitlistPosition(rows, second.id)).toBe(2);

    await prisma.participant.update({
      where: { id: first.id },
      data: { status: "ATTENDING", waitlistedAt: null, scheduleId: null, pricePlanId: null },
    });

    const remaining = await prisma.participant.findMany({
      where: { eventId: event.id, status: "WAITLISTED" },
      select: { id: true, status: true, waitlistedAt: true, createdAt: true },
    });
    expect(waitlistPosition(remaining, second.id)).toBe(1);
    expect(waitlistPosition(remaining, first.id)).toBeNull();
    expect(waitlistPosition(remaining, attending.id)).toBeNull();
  });

  it("要望の一覧は出席者を混ぜずに数えられる", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await seedParticipant(event.id, "ATTENDING", "出席者");
    await seedParticipant(event.id, "WAITLISTED", "要望1", new Date("2026-10-22T01:00:00.000Z"));
    await seedParticipant(event.id, "WAITLISTED", "要望2", new Date("2026-10-22T02:00:00.000Z"));

    const [attendingCount, waitlistedCount] = await Promise.all([
      prisma.participant.count({ where: { eventId: event.id, status: "ATTENDING" } }),
      prisma.participant.count({ where: { eventId: event.id, status: "WAITLISTED" } }),
    ]);
    expect(attendingCount).toBe(1);
    expect(waitlistedCount).toBe(2);
  });
});
