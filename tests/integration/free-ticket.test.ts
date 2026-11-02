import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { pickUsableTicket, referralGrantSize, ticketExpiresAt } from "@/modules/billing/lib/tickets";
import { cleanup, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

async function createUser() {
  return prisma.user.create({
    data: {
      email: uniqueEmail("free-ticket"),
      name: "チケットの会員",
      phoneVerifiedAt: new Date(),
      quota: { create: { freeEventCount: 0, paidCredits: 0 } },
    },
  });
}

describeDb("無料チケットの台帳（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  async function user() {
    const created = await createUser();
    userIds.push(created.id);
    return created;
  }

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("同じ理由キーでは2枚作れない", async () => {
    const owner = await user();
    const issuedAt = new Date("2026-11-02T00:00:00.000Z");
    const data = {
      userId: owner.id,
      source: "REFERRAL" as const,
      reasonKey: `referral:${owner.id}`,
      expiresAt: ticketExpiresAt("REFERRAL", issuedAt),
    };

    await prisma.freeTicket.create({ data });
    await expect(prisma.freeTicket.create({ data })).rejects.toThrow();

    const count = await prisma.freeTicket.count({ where: { userId: owner.id } });
    expect(count).toBe(1);
  });

  it("期限切れの券は、残っていても選ばれない", async () => {
    const owner = await user();
    const now = new Date("2026-11-02T00:00:00.000Z");

    await prisma.freeTicket.create({
      data: {
        userId: owner.id,
        source: "AD",
        expiresAt: new Date(now.getTime() - DAY_MS),
      },
    });
    const alive = await prisma.freeTicket.create({
      data: {
        userId: owner.id,
        source: "REFERRAL",
        expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      },
    });

    const rows = await prisma.freeTicket.findMany({
      where: { userId: owner.id, usedAt: null },
      orderBy: { expiresAt: "desc" },
    });
    expect(rows.map((row) => row.id)).toContain(alive.id);
    expect(pickUsableTicket(rows, now)?.id).toBe(alive.id);
  });

  it("期限切れの券には使用の印を立てられない（更新の条件で弾く）", async () => {
    const owner = await user();
    const now = new Date("2026-11-02T00:00:00.000Z");
    const expired = await prisma.freeTicket.create({
      data: {
        userId: owner.id,
        source: "AD",
        expiresAt: new Date(now.getTime() - DAY_MS),
      },
    });

    // P2 の消費と同じ条件。期限を条件に入れないと、切れた券で公開できてしまう。
    const updated = await prisma.freeTicket.updateMany({
      where: { id: expired.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    expect(updated.count).toBe(0);
  });

  it("同じ券を2回消費できない", async () => {
    const owner = await user();
    const now = new Date("2026-11-02T00:00:00.000Z");
    const ticket = await prisma.freeTicket.create({
      data: {
        userId: owner.id,
        source: "REFERRAL",
        expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      },
    });
    const where = { id: ticket.id, usedAt: null, expiresAt: { gt: now } };

    expect((await prisma.freeTicket.updateMany({ where, data: { usedAt: now } })).count).toBe(1);
    expect((await prisma.freeTicket.updateMany({ where, data: { usedAt: now } })).count).toBe(0);
  });

  it("紹介の数え上げが生涯上限に達すると、これ以上配らない", async () => {
    const referrer = await user();
    const guest = await user();

    await prisma.freeTicket.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        userId: referrer.id,
        source: "REFERRAL" as const,
        grantedByUserId: guest.id,
        reasonKey: `seed:${referrer.id}:${index}`,
        expiresAt: new Date("2027-02-02T00:00:00.000Z"),
      })),
    });

    const granted = await prisma.freeTicket.count({
      where: { userId: referrer.id, source: "REFERRAL" },
    });
    expect(granted).toBe(10);
    expect(referralGrantSize(granted)).toBe(0);
  });

  it("会員を消すと券も消える（退会の後始末）", async () => {
    const owner = await user();
    await prisma.freeTicket.create({
      data: {
        userId: owner.id,
        source: "MANUAL",
        expiresAt: new Date("2027-02-02T00:00:00.000Z"),
      },
    });

    await prisma.user.delete({ where: { id: owner.id } });
    userIds.splice(userIds.indexOf(owner.id), 1);

    expect(await prisma.freeTicket.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("紹介のコードは会員ごとに一意で、誰の紹介かは1度だけ決まる", async () => {
    const referrer = await user();
    const guest = await user();

    await prisma.user.update({
      where: { id: referrer.id },
      data: { referralCode: "x7Kd2mQp" },
    });
    await prisma.user.update({
      where: { id: guest.id },
      data: { referredByUserId: referrer.id },
    });

    const other = await user();
    await expect(
      prisma.user.update({ where: { id: other.id }, data: { referralCode: "x7Kd2mQp" } }),
    ).rejects.toThrow();

    const found = await prisma.user.findUniqueOrThrow({ where: { id: guest.id } });
    expect(found.referredByUserId).toBe(referrer.id);
  });
});
