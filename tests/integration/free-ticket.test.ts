import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { CreateEventSchema } from "@/lib/schemas";
import { signLocalToken } from "@/modules/auth/lib/auth";
import {
  FREE_EVENT_LIMIT,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  assertCanCreateEvent,
  jstToday,
} from "@/modules/billing/lib/quota";
import {
  pickUsableTicket,
  referralGrantSize,
  ticketExpiresAt,
} from "@/modules/billing/lib/tickets";
import { createEventForUser, publishDraftEvent } from "@/modules/events/lib/events";
import { GET as getQuota } from "@/app/api/v1/billing/quota/route";
import { PUT as putEvent } from "@/app/api/v1/organizer/events/[id]/route";
import { GET as getReferral } from "@/app/api/v1/user/referral/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

interface MemberOptions {
  paidCredits?: number;
  freeEventCount?: number;
  plan?: "MONTHLY_8" | "UNLIMITED";
  subscriptionStatus?: "NONE" | "ACTIVE";
  phoneVerified?: boolean;
  referralCode?: string;
}

async function createUser(input: MemberOptions = {}) {
  const subscriptionStatus = input.subscriptionStatus ?? "NONE";
  return prisma.user.create({
    data: {
      email: uniqueEmail("free-ticket"),
      name: "チケットの会員",
      phoneVerifiedAt: input.phoneVerified === false ? null : new Date(),
      referralCode: input.referralCode ?? null,
      quota: {
        create: {
          freeEventCount: input.freeEventCount ?? 0,
          paidCredits: input.paidCredits ?? 0,
          subscriptionStatus,
          subscriptionPlan: input.plan ?? "NONE",
          currentPeriodEnd:
            subscriptionStatus === "ACTIVE" ? new Date(Date.now() + 7 * DAY_MS) : null,
        },
      },
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

describeDb("無料チケットの消費順（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  async function member(input: MemberOptions = {}) {
    const created = await createUser(input);
    userIds.push(created.id);
    return created;
  }

  function inDays(days: number): Date {
    return new Date(Date.now() + days * DAY_MS);
  }

  /** 今日（JST）から days 日ずらした開催日。 */
  function eventDay(days: number): Date {
    return new Date(jstToday(new Date()).getTime() + days * DAY_MS);
  }

  async function giveTicket(
    userId: string,
    options: { expiresAt: Date; source?: "AD" | "REFERRAL" | "MANUAL" },
  ) {
    return prisma.freeTicket.create({
      data: {
        userId,
        source: options.source ?? "REFERRAL",
        expiresAt: options.expiresAt,
      },
    });
  }

  async function draft(userId: string) {
    const created = await seedEvent({ userId, role: "OWNER", status: "DRAFT" });
    eventIds.push(created.id);
    return created;
  }

  async function seedPublished(userId: string) {
    const created = await seedEvent({
      userId,
      role: "OWNER",
      status: "PUBLISHED",
      quotaSource: "SUBSCRIPTION",
      scheduleDates: [eventDay(7)],
    });
    eventIds.push(created.id);
    return created;
  }

  async function quotaOf(userId: string) {
    return prisma.userUsageQuota.findUniqueOrThrow({ where: { userId } });
  }

  async function expectQuotaError(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      expect((error as ProblemDetailException).status).toBe(402);
      expect((error as ProblemDetailException).extras.error).toBe(code);
    }
  }

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("券と単発クレジットの両方があるとき、券が先に減る", async () => {
    const user = await member({ paidCredits: 1 });
    const ticket = await giveTicket(user.id, { expiresAt: inDays(30) });
    const target = await draft(user.id);

    const published = await publishDraftEvent(user.id, target.id);

    // チケット経由でも、イベントに残す種別は単発クレジットのまま（QuotaSource は増やさない）。
    expect(published.quotaSource).toBe("PAID_CREDIT");
    expect((await quotaOf(user.id)).paidCredits).toBe(1);
    const used = await prisma.freeTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(used.usedAt).not.toBeNull();
    expect(used.eventId).toBe(target.id);
  });

  it("期限切れの券しかないときは、券を使わず単発クレジットに進む", async () => {
    const user = await member({ paidCredits: 1 });
    const expired = await giveTicket(user.id, { expiresAt: inDays(-1) });
    const target = await draft(user.id);

    const published = await publishDraftEvent(user.id, target.id);

    expect(published.quotaSource).toBe("PAID_CREDIT");
    expect((await quotaOf(user.id)).paidCredits).toBe(0);
    const stillThere = await prisma.freeTicket.findUniqueOrThrow({ where: { id: expired.id } });
    expect(stillThere.usedAt).toBeNull();
  });

  it("8件プランが満杯でも、券があれば1件だけ通る", async () => {
    const user = await member({ plan: "MONTHLY_8", subscriptionStatus: "ACTIVE" });
    for (let index = 0; index < SUBSCRIPTION_PUBLISHED_EVENT_LIMIT; index += 1) {
      await seedPublished(user.id);
    }
    const ticket = await giveTicket(user.id, { expiresAt: inDays(30) });
    const target = await draft(user.id);

    const published = await publishDraftEvent(user.id, target.id);

    expect(published.status).toBe("PUBLISHED");
    expect(published.quotaSource).toBe("PAID_CREDIT");
    const used = await prisma.freeTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(used.eventId).toBe(target.id);

    // 2枚目は無いので、次の公開は 402（無料チケットでは抜けられない）。
    const blocked = await draft(user.id);
    await expectQuotaError(publishDraftEvent(user.id, blocked.id), "PUBLISHED_EVENTS_FULL");
  });

  it("券は1枚につき1回だけ使える", async () => {
    const user = await member({ freeEventCount: FREE_EVENT_LIMIT });
    await giveTicket(user.id, { expiresAt: inDays(30) });
    const first = await draft(user.id);
    const second = await draft(user.id);

    expect((await publishDraftEvent(user.id, first.id)).quotaSource).toBe("PAID_CREDIT");
    await expectQuotaError(publishDraftEvent(user.id, second.id), "QUOTA_EXCEEDED");

    const left = await prisma.freeTicket.count({
      where: { userId: user.id, usedAt: null },
    });
    expect(left).toBe(0);
  });

  it("期限が近い券から使う", async () => {
    const user = await member();
    const later = await giveTicket(user.id, { expiresAt: inDays(60) });
    const sooner = await giveTicket(user.id, { expiresAt: inDays(2) });
    const target = await draft(user.id);

    await publishDraftEvent(user.id, target.id);

    expect((await prisma.freeTicket.findUniqueOrThrow({ where: { id: sooner.id } })).usedAt).not.toBeNull();
    expect((await prisma.freeTicket.findUniqueOrThrow({ where: { id: later.id } })).usedAt).toBeNull();
  });

  it("即公開でも、使った券にイベントが結ばれる", async () => {
    const user = await member();
    const ticket = await giveTicket(user.id, { expiresAt: inDays(30) });
    const input = CreateEventSchema.parse({
      title: "即公開の催し",
      schedules: [{ eventDate: "2026-12-15", startTime: "18:00", endTime: "20:00" }],
      pricePlans: [{ name: "一般", amount: 3000 }],
      location: "テスト会場",
      rainPolicy: "RAIN_OR_SHINE",
      status: "PUBLISHED",
    });

    const { event } = await createEventForUser(user.id, input);
    eventIds.push(event.id);

    // 即公開はイベント行を作る前にチケットを消費する。作成後に券と結び直せていないと空のまま残る。
    expect(event.quotaSource).toBe("PAID_CREDIT");
    const used = await prisma.freeTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(used.usedAt).not.toBeNull();
    expect(used.eventId).toBe(event.id);
  });

  it("券だけでも作成できると判定する（単発クレジットも無料チケットも無くても）", async () => {
    const user = await member({ freeEventCount: FREE_EVENT_LIMIT, phoneVerified: false });
    await giveTicket(user.id, { expiresAt: inDays(3) });

    const decision = await assertCanCreateEvent(user.id);
    expect(decision.type).toBe("PAID_CREDIT");
  });

  it("quota API がチケットの残りと紹介の実績を返す", async () => {
    const referrer = await member({ referralCode: "x7Kd2mQp" });
    const guest = await member();
    const adExpiresAt = inDays(7);
    const ad = await giveTicket(referrer.id, { source: "AD", expiresAt: adExpiresAt });
    await giveTicket(referrer.id, { source: "REFERRAL", expiresAt: inDays(90) });
    // 紹介者が配った2枚（受け取ったのは別の会員）。
    await prisma.freeTicket.createMany({
      data: [0, 1].map((index) => ({
        userId: guest.id,
        source: "REFERRAL" as const,
        grantedByUserId: referrer.id,
        reasonKey: `referral:${guest.id}:${index}`,
        expiresAt: inDays(90),
      })),
    });

    const response = await getQuota(
      new NextRequest("http://localhost/api/v1/billing/quota", {
        headers: { cookie: `auth_token=${await signLocalToken({ userId: referrer.id, email: referrer.email })}` },
      }),
    );
    const body = await response.json();

    expect(body.tickets.available).toBe(2);
    // 期限が最も早いのは動画券（7日）。
    expect(body.tickets.expiringAt).toBe(adExpiresAt.toISOString());
    expect(body.tickets.ad.nextGrantAt).toBe(
      new Date(ad.issuedAt.getTime() + 30 * DAY_MS).toISOString(),
    );
    expect(body.tickets.referral).toEqual({
      code: "x7Kd2mQp",
      grantedCount: 2,
      limit: 10,
    });
    // 券があるので、無料チケットが尽きていても作成できると返す。
    expect(body.canCreate).toBe(true);
  });
});

describeDb("紹介の付与（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  async function member(referredByUserId: string | null = null) {
    const created = await prisma.user.create({
      data: {
        email: uniqueEmail("referral"),
        name: "紹介の会員",
        phoneVerifiedAt: new Date(),
        referredByUserId,
        quota: { create: {} },
      },
    });
    userIds.push(created.id);
    return created;
  }

  async function draft(userId: string) {
    const created = await seedEvent({ userId, role: "OWNER", status: "DRAFT" });
    eventIds.push(created.id);
    return created;
  }

  /** 紹介者が受け取った券。`grantedByUserId` で「誰の紹介か」を数える。 */
  async function grantedTo(referrerId: string) {
    return prisma.freeTicket.findMany({
      where: { userId: referrerId, source: "REFERRAL" },
      orderBy: { reasonKey: "asc" },
    });
  }

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("紹介された人が初回公開すると、紹介者に2枚付く", async () => {
    const referrer = await member();
    const guest = await member(referrer.id);
    const target = await draft(guest.id);

    await publishDraftEvent(guest.id, target.id);

    const tickets = await grantedTo(referrer.id);
    expect(tickets).toHaveLength(2);
    // 誰の紹介で配ったかが残る（紹介の実績はここで数える）。
    expect(tickets.every((ticket) => ticket.grantedByUserId === guest.id)).toBe(true);
    // 紹介券は3か月。期限は発行のたびに同じ日へそろう。
    expect(tickets[0].expiresAt.toISOString()).toBe(tickets[1].expiresAt.toISOString());
  });

  it("2回目の公開では増えない", async () => {
    const referrer = await member();
    const guest = await member(referrer.id);
    const first = await draft(guest.id);
    const second = await draft(guest.id);

    await publishDraftEvent(guest.id, first.id);
    await publishDraftEvent(guest.id, second.id);

    expect(await grantedTo(referrer.id)).toHaveLength(2);
  });

  it("自分で自分を紹介しても付かない", async () => {
    const guest = await member();
    await prisma.user.update({ where: { id: guest.id }, data: { referredByUserId: guest.id } });
    const target = await draft(guest.id);

    await publishDraftEvent(guest.id, target.id);

    expect(await grantedTo(guest.id)).toHaveLength(0);
  });

  it("紹介者が退会していたら付かない", async () => {
    const referrer = await member();
    const guest = await member(referrer.id);
    await prisma.user.update({
      where: { id: referrer.id },
      data: { deletedAt: new Date() },
    });
    const target = await draft(guest.id);

    await publishDraftEvent(guest.id, target.id);

    expect(await grantedTo(referrer.id)).toHaveLength(0);
  });

  it("生涯10枚に達していたら、これ以上は付かない", async () => {
    const referrer = await member();
    const donor = await member();
    await prisma.freeTicket.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        userId: referrer.id,
        source: "REFERRAL" as const,
        grantedByUserId: donor.id,
        reasonKey: `seed:referral:${referrer.id}:${index}`,
        expiresAt: new Date("2027-02-02T00:00:00.000Z"),
      })),
    });
    const guest = await member(referrer.id);
    const target = await draft(guest.id);

    await publishDraftEvent(guest.id, target.id);

    expect(await grantedTo(referrer.id)).toHaveLength(10);
  });

  it("即公開でも、紹介者に2枚付く", async () => {
    const referrer = await member();
    const guest = await member(referrer.id);
    const input = CreateEventSchema.parse({
      title: "紹介からの即公開",
      schedules: [{ eventDate: "2026-12-15", startTime: "18:00", endTime: "20:00" }],
      pricePlans: [{ name: "一般", amount: 3000 }],
      location: "テスト会場",
      rainPolicy: "RAIN_OR_SHINE",
      status: "PUBLISHED",
    });

    const { event } = await createEventForUser(guest.id, input);
    eventIds.push(event.id);

    expect(await grantedTo(referrer.id)).toHaveLength(2);
  });

  it("編集画面の保存から公開しても、紹介者に2枚付く", async () => {
    const referrer = await member();
    const guest = await member(referrer.id);
    const target = await draft(guest.id);

    // 編集画面は排他ロックを取ってから PUT する。
    const lockToken = "referral-edit-lock";
    await prisma.eventLock.create({
      data: {
        eventId: target.id,
        lockedByUserId: guest.id,
        lockHolderName: "紹介の会員",
        lockTokenHash: sha256(lockToken),
      },
    });

    const response = await putEvent(
      new NextRequest(`http://localhost/api/v1/organizer/events/${target.id}`, {
        method: "PUT",
        headers: {
          cookie: `auth_token=${await signLocalToken({ userId: guest.id, email: guest.email })}`,
          "x-lock-token": lockToken,
        },
        body: JSON.stringify({
          title: "編集画面から公開する催し",
          schedules: [{ eventDate: "2026-12-15", startTime: "18:00", endTime: "20:00" }],
          pricePlans: [{ name: "一般", amount: 3000 }],
          location: "テスト会場",
          rainPolicy: "RAIN_OR_SHINE",
          status: "PUBLISHED",
        }),
      }),
      { params: { id: target.id } },
    );

    expect(response.status).toBe(200);
    const published = await prisma.event.findUniqueOrThrow({ where: { id: target.id } });
    expect(published.status).toBe("PUBLISHED");
    // 公開の副作用は `publishDraftEvent` に集約されている（quotaSource も残る）。
    expect(published.quotaSource).toBe("FREE_TRIAL");
    expect(await grantedTo(referrer.id)).toHaveLength(2);
  });

  it("紹介 API がリンクと実績を返す（コードは初回に作る）", async () => {
    const referrer = await member();
    const guest = await member(referrer.id);

    const response = await getReferral(
      new NextRequest("http://localhost/api/v1/user/referral", {
        headers: {
          cookie: `auth_token=${await signLocalToken({ userId: referrer.id, email: referrer.email })}`,
        },
      }),
    );
    const body = await response.json();

    expect(body.code).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(body.url).toContain(`/invite/${body.code}`);
    expect(body.invited).toBe(1);
    expect(body.granted).toBe(0);
    expect(body.limit).toBe(10);

    // 2回目は同じコードを返す（作ったコードは変えない）。
    const again = await getReferral(
      new NextRequest("http://localhost/api/v1/user/referral", {
        headers: {
          cookie: `auth_token=${await signLocalToken({ userId: referrer.id, email: referrer.email })}`,
        },
      }),
    );
    expect((await again.json()).code).toBe(body.code);

    // この会員を紹介した人ではないので、実績には数えない。
    expect(guest.referredByUserId).toBe(referrer.id);
  });
});
