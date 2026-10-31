import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { groupByPlan, summarizeRevenue } from "@/modules/revenue/lib/revenue";
import { saveAllocationSetting } from "@/modules/revenue/lib/allocation-store";
import { buildAllocationView } from "@/modules/revenue/lib/allocation-view";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function token(): string {
  return sha256(randomUUID());
}

async function createUser(name: string) {
  return prisma.user.create({ data: { email: uniqueEmail("revenue"), name } });
}

const organizerSelect = {
  id: true,
  role: true,
  userId: true,
  displayName: true,
  user: { select: { name: true } },
} as const;

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
      {
        name: "一般",
        audience: "ANY",
        amount: 3000,
        attendingCount: 1,
        discountSubtotal: 0,
        subtotal: 3000,
      },
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

  it("按分を保存し、主催者は全員分・共同主催者は自分の行だけを見る", async () => {
    const owner = await createUser("主催者の会員");
    const guest = await createUser("共同主催の会員");
    userIds.push(owner.id, guest.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: guest.id, role: "CO_HOST" },
    });

    const organizers = await prisma.eventOrganizer.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      select: organizerSelect,
    });

    await saveAllocationSetting({
      eventId: event.id,
      mode: "RATIO",
      visibility: "OWN_ONLY",
      rows: organizers.map((row, index) => ({
        organizerId: row.id,
        shareBps: index === 0 ? 7000 : 3000,
        headcount: null,
      })),
      organizerIds: organizers.map((row) => row.id),
      updatedByUserId: owner.id,
    });

    const source = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: {
        revenueSetting: { select: { mode: true, visibility: true } },
        revenueShares: { select: { organizerId: true, shareBps: true, headcount: true } },
      },
    });

    const base = {
      organizers,
      setting: source.revenueSetting,
      shares: source.revenueShares,
      expectedRevenue: 10000,
      issuedRevenue: 10000,
      attendingCount: 2,
    };

    const ownerView = buildAllocationView({
      ...base,
      viewerUserId: owner.id,
      viewerRole: "OWNER",
    });
    expect(ownerView.configured).toBe(true);
    expect(ownerView.canEdit).toBe(true);
    expect(ownerView.rows.map((row) => row.expectedRevenue)).toEqual([7000, 3000]);
    expect(ownerView.hiddenRows).toBe(0);

    const coHostView = buildAllocationView({
      ...base,
      viewerUserId: guest.id,
      viewerRole: "CO_HOST",
    });
    expect(coHostView.canEdit).toBe(false);
    expect(coHostView.rows).toHaveLength(1);
    expect(coHostView.rows[0]).toMatchObject({ isYou: true, expectedRevenue: 3000 });
    expect(coHostView.hiddenRows).toBe(1);
  });

  it("visibility = ALL なら共同主催者も全員分を見られる", async () => {
    const owner = await createUser("主催者の会員");
    const guest = await createUser("共同主催の会員");
    userIds.push(owner.id, guest.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: guest.id, role: "CO_HOST" },
    });

    const organizers = await prisma.eventOrganizer.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      select: organizerSelect,
    });

    await saveAllocationSetting({
      eventId: event.id,
      mode: "HEADCOUNT",
      visibility: "ALL",
      rows: organizers.map((row, index) => ({
        organizerId: row.id,
        shareBps: null,
        headcount: index === 0 ? 2 : 1,
      })),
      organizerIds: organizers.map((row) => row.id),
      updatedByUserId: owner.id,
    });

    const source = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: {
        revenueSetting: { select: { mode: true, visibility: true } },
        revenueShares: { select: { organizerId: true, shareBps: true, headcount: true } },
      },
    });

    const view = buildAllocationView({
      organizers,
      setting: source.revenueSetting,
      shares: source.revenueShares,
      viewerUserId: guest.id,
      viewerRole: "CO_HOST",
      expectedRevenue: 9000,
      issuedRevenue: 0,
      attendingCount: 3,
    });

    expect(view.mode).toBe("HEADCOUNT");
    expect(view.rows).toHaveLength(2);
    expect(view.hiddenRows).toBe(0);
    expect(view.unallocated).toEqual({ headcount: 0, expectedRevenue: 0, issuedRevenue: 0 });
  });

  it("共同主催を解除すると配分行も消え、残った主催者だけで再計算する", async () => {
    const owner = await createUser("主催者の会員");
    const guest = await createUser("共同主催の会員");
    userIds.push(owner.id, guest.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    const coHost = await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: guest.id, role: "CO_HOST" },
    });

    const organizers = await prisma.eventOrganizer.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      select: organizerSelect,
    });
    await saveAllocationSetting({
      eventId: event.id,
      mode: "RATIO",
      visibility: "ALL",
      rows: organizers.map((row) => ({
        organizerId: row.id,
        shareBps: 5000,
        headcount: null,
      })),
      organizerIds: organizers.map((row) => row.id),
      updatedByUserId: owner.id,
    });

    await prisma.eventOrganizer.delete({ where: { id: coHost.id } });

    const remaining = await prisma.eventOrganizer.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      select: organizerSelect,
    });
    const source = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      select: {
        revenueSetting: { select: { mode: true, visibility: true } },
        revenueShares: { select: { organizerId: true, shareBps: true, headcount: true } },
      },
    });

    expect(source.revenueShares).toHaveLength(1);
    const view = buildAllocationView({
      organizers: remaining,
      setting: source.revenueSetting,
      shares: source.revenueShares,
      viewerUserId: owner.id,
      viewerRole: "OWNER",
      expectedRevenue: 10000,
      issuedRevenue: 0,
      attendingCount: 1,
    });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].expectedRevenue).toBe(10000);
  });
});
