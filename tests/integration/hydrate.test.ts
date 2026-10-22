import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { migrateGuestOrganizers } from "@/modules/auth/lib/hydrate";
import { FREE_EVENT_LIMIT } from "@/modules/billing/lib/quota";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function createUser(freeEventCount = 0) {
  return prisma.user.create({
    data: {
      email: uniqueEmail("hydrate"),
      name: "テスト会員",
      quota: { create: { freeEventCount } },
    },
  });
}

describeDb("migrateGuestOrganizers（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("筆頭幹事の分だけ無料枠に移し、共同幹事は数えない", async () => {
    const user = await createUser(0);
    userIds.push(user.id);

    const ownerToken = "token-owner";
    const cohostToken = "token-cohost";
    const ownerEvent = await seedEvent({ guestTokenHash: sha256(ownerToken), role: "OWNER" });
    const cohostEvent = await seedEvent({ guestTokenHash: sha256(cohostToken), role: "CO_HOST" });
    eventIds.push(ownerEvent.id, cohostEvent.id);

    const result = await prisma.$transaction((tx) =>
      migrateGuestOrganizers(tx, user.id, [ownerToken, cohostToken]),
    );

    expect(result.migratedOrganizers).toBe(2);
    expect(result.promotedOwners).toBe(1);
    expect(result.freeEventCount).toBe(1);

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(1);

    const organizers = await prisma.eventOrganizer.findMany({
      where: { eventId: { in: [ownerEvent.id, cohostEvent.id] } },
    });
    expect(organizers.every((row) => row.userId === user.id && row.guestTokenHash === null)).toBe(true);
  });

  it("同じ端末で二度呼んでも枠は増えない", async () => {
    const user = await createUser(0);
    userIds.push(user.id);

    const token = "token-once";
    const event = await seedEvent({ guestTokenHash: sha256(token), role: "OWNER" });
    eventIds.push(event.id);

    await prisma.$transaction((tx) => migrateGuestOrganizers(tx, user.id, [token]));
    const second = await prisma.$transaction((tx) => migrateGuestOrganizers(tx, user.id, [token]));

    expect(second.migratedOrganizers).toBe(0);
    expect(second.freeEventCount).toBeNull();
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(1);
  });

  it("無料枠の上限を超えない", async () => {
    const user = await createUser(FREE_EVENT_LIMIT);
    userIds.push(user.id);

    const token = "token-limit";
    const event = await seedEvent({ guestTokenHash: sha256(token), role: "OWNER" });
    eventIds.push(event.id);

    const result = await prisma.$transaction((tx) => migrateGuestOrganizers(tx, user.id, [token]));

    expect(result.freeEventCount).toBe(FREE_EVENT_LIMIT);
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: user.id } });
    expect(quota.freeEventCount).toBe(FREE_EVENT_LIMIT);
  });

  it("ゲスト OWNER と会員 CO_HOST が同じイベントに居ても、オーナーを失わない", async () => {
    const user = await createUser(0);
    userIds.push(user.id);

    const token = "token-owner-and-cohost";
    // 同じイベントに、端末の OWNER 行と会員の CO_HOST 行が並ぶ状態を作る。
    const event = await seedEvent({ guestTokenHash: sha256(token), role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: user.id, role: "CO_HOST" },
    });

    const result = await prisma.$transaction((tx) => migrateGuestOrganizers(tx, user.id, [token]));

    expect(result.promotedOwners).toBe(1);
    const organizers = await prisma.eventOrganizer.findMany({ where: { eventId: event.id } });
    expect(organizers).toHaveLength(1);
    expect(organizers[0].role).toBe("OWNER");
    expect(organizers[0].userId).toBe(user.id);
    expect(organizers[0].guestTokenHash).toBeNull();
  });

  it("1イベントに OWNER を2行は作れない（部分ユニーク索引）", async () => {
    const user = await createUser(0);
    userIds.push(user.id);
    const event = await seedEvent({ guestTokenHash: sha256("token-single-owner"), role: "OWNER" });
    eventIds.push(event.id);

    await expect(
      prisma.eventOrganizer.create({ data: { eventId: event.id, userId: user.id, role: "OWNER" } }),
    ).rejects.toThrow();
  });
});
