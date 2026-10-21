import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { groupByPlan, summarizeRevenue } from "@/modules/revenue/lib/revenue";
import { cleanup, seedEvent } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function token(): string {
  return sha256(randomUUID());
}

describeDb("売上の集計（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("プラン金額を編集しても、申込済み参加者の見込み売上は変わらない", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    const plan = await prisma.eventPricePlan.create({
      data: { eventId: event.id, name: "一般", audience: "ANY", amount: 3000, sortOrder: 0 },
    });
    await prisma.participant.create({
      data: {
        eventId: event.id,
        rsvpTokenHash: token(),
        name: "田中",
        status: "ATTENDING",
        pricePlanId: plan.id,
        priceAmount: 3000,
        pricePlanName: "一般",
        priceAudience: "ANY",
      },
    });

    await prisma.eventPricePlan.update({
      where: { id: plan.id },
      data: { amount: 5000, name: "一般（改定）" },
    });

    const rows = await prisma.participant.findMany({ where: { eventId: event.id } });
    expect(summarizeRevenue(rows).expectedRevenue).toBe(3000);
    expect(groupByPlan(rows)).toEqual([
      { name: "一般", audience: "ANY", amount: 3000, attendingCount: 1, subtotal: 3000 },
    ]);
  });

  it("領収書発行額と見込みの差額を出す", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    const plan = await prisma.eventPricePlan.create({
      data: { eventId: event.id, name: "一般", audience: "ANY", amount: 4000, sortOrder: 0 },
    });
    const paid = await prisma.participant.create({
      data: {
        eventId: event.id,
        rsvpTokenHash: token(),
        name: "佐藤",
        status: "ATTENDING",
        pricePlanId: plan.id,
        priceAmount: 4000,
        pricePlanName: "一般",
        priceAudience: "ANY",
      },
    });
    await prisma.participant.create({
      data: {
        eventId: event.id,
        rsvpTokenHash: token(),
        name: "鈴木",
        status: "ATTENDING",
        pricePlanId: plan.id,
        priceAmount: 4000,
        pricePlanName: "一般",
        priceAudience: "ANY",
      },
    });
    await prisma.receipt.create({
      data: {
        participantId: paid.id,
        eventId: event.id,
        addressee: "佐藤",
        amount: 4000,
        description: "参加費",
        issuerName: "テスト幹事",
      },
    });

    const [rows, receipts] = await Promise.all([
      prisma.participant.findMany({ where: { eventId: event.id } }),
      prisma.receipt.findMany({ where: { eventId: event.id }, select: { amount: true } }),
    ]);

    const summary = summarizeRevenue(rows, receipts);
    expect(summary.expectedRevenue).toBe(8000);
    expect(summary.issuedRevenue).toBe(4000);
    expect(summary.unreconciled).toBe(4000);
    expect(summary.averagePerAttendee).toBe(4000);
  });

  it("不参加は売上に含めず、欠席数として数える", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.participant.create({
      data: {
        eventId: event.id,
        rsvpTokenHash: token(),
        name: "高橋",
        status: "DECLINED",
      },
    });

    const rows = await prisma.participant.findMany({ where: { eventId: event.id } });
    const summary = summarizeRevenue(rows);
    expect(summary.expectedRevenue).toBe(0);
    expect(summary.attendingCount).toBe(0);
    expect(summary.declinedCount).toBe(1);
  });
});
