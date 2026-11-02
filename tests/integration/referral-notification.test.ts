import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { notifyReferralGranted } from "@/modules/notifications/lib/notify";
import { publishDraftEvent } from "@/modules/events/lib/events";
import { GET as getNotifications } from "@/app/api/v1/notifications/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * 紹介でチケットが配られたときの通知。文面と指紋は
 * `tests/unit/referral-notification.test.ts` が見ているので、ここでは
 * 「誰に・何行・どこへ」と、公開が通知の失敗に巻き込まれないことを確かめる。
 */

async function createUser(name: string) {
  return prisma.user.create({
    data: {
      email: uniqueEmail("referral-notification"),
      name,
      phoneVerifiedAt: new Date(),
      quota: { create: {} },
    },
  });
}

function tokenFor(user: { id: string; email: string }) {
  return signLocalToken({ userId: user.id, email: user.email });
}

describeDb("紹介の付与の通知（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("催しに紐づかない 1 行として、紹介者にだけ作られる", async () => {
    const referrer = await createUser("紹介する人");
    const guest = await createUser("紹介された人");
    userIds.push(referrer.id, guest.id);

    const created = await notifyReferralGranted({
      referrerId: referrer.id,
      newUserId: guest.id,
      granted: 2,
    });

    expect(created).toBe(1);
    const rows = await prisma.notification.findMany({ where: { userId: referrer.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("REFERRAL_GRANTED");
    expect(rows[0].eventId).toBeNull();
    expect(rows[0].participantId).toBeNull();
    expect(rows[0].title).toBe("紹介でチケットが届きました");
    expect(rows[0].body).toContain("紹介された人");
    expect(rows[0].readAt).toBeNull();
    // 宛先は紹介者だけ。紹介された人には作らない。
    expect(await prisma.notification.count({ where: { userId: guest.id } })).toBe(0);
  });

  it("同じ紹介で 2 回呼んでも増えない", async () => {
    const referrer = await createUser("紹介する人");
    const guest = await createUser("紹介された人");
    userIds.push(referrer.id, guest.id);
    const input = { referrerId: referrer.id, newUserId: guest.id, granted: 2 };

    expect(await notifyReferralGranted(input)).toBe(1);
    expect(await notifyReferralGranted(input)).toBe(0);
    expect(await prisma.notification.count({ where: { userId: referrer.id } })).toBe(1);
  });

  it("紹介された人が違えば、同じ紹介者に別の行が増える", async () => {
    const referrer = await createUser("紹介する人");
    const first = await createUser("紹介された人1");
    const second = await createUser("紹介された人2");
    userIds.push(referrer.id, first.id, second.id);

    await notifyReferralGranted({
      referrerId: referrer.id,
      newUserId: first.id,
      granted: 2,
    });
    await notifyReferralGranted({
      referrerId: referrer.id,
      newUserId: second.id,
      granted: 2,
    });

    expect(await prisma.notification.count({ where: { userId: referrer.id } })).toBe(2);
  });

  it("紹介された人が消えていても、文面は壊れずに作られる", async () => {
    const referrer = await createUser("紹介する人");
    userIds.push(referrer.id);

    const created = await notifyReferralGranted({
      referrerId: referrer.id,
      newUserId: "00000000-0000-4000-8000-000000000000",
      granted: 1,
    });

    expect(created).toBe(1);
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: referrer.id } });
    expect(row.body).toContain("紹介された方");
    expect(row.body).toContain("チケット1枚");
  });

  it("通知 API は href をマイページにし、eventId を null で返す", async () => {
    const referrer = await createUser("紹介する人");
    const guest = await createUser("紹介された人");
    userIds.push(referrer.id, guest.id);
    await notifyReferralGranted({
      referrerId: referrer.id,
      newUserId: guest.id,
      granted: 2,
    });

    const response = await getNotifications(
      new NextRequest("http://localhost/api/v1/notifications?limit=10", {
        headers: { cookie: `auth_token=${await tokenFor(referrer)}` },
      }),
    );
    const body = await response.json();

    expect(body.unreadCount).toBe(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].kind).toBe("REFERRAL_GRANTED");
    expect(body.notifications[0].eventId).toBeNull();
    expect(body.notifications[0].href).toBe("/mypage");
  });

  it("出欠の通知と混ざっても、行き先は種別ごとに分かれる", async () => {
    const owner = await createUser("主催者");
    userIds.push(owner.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.notification.create({
      data: {
        userId: owner.id,
        eventId: event.id,
        kind: "RSVP_ATTENDING",
        title: "参加表明がありました",
        body: "誰かさんが出席します。",
        dedupeKey: `test:${event.id}`,
      },
    });
    await notifyReferralGranted({
      referrerId: owner.id,
      newUserId: owner.id,
      granted: 2,
    });

    const response = await getNotifications(
      new NextRequest("http://localhost/api/v1/notifications?limit=10", {
        headers: { cookie: `auth_token=${await tokenFor(owner)}` },
      }),
    );
    const body = await response.json();
    const hrefOf = (kind: string) =>
      body.notifications.find((row: { kind: string }) => row.kind === kind)?.href;

    expect(hrefOf("RSVP_ATTENDING")).toBe(`/organizer/events/${event.id}/participants`);
    expect(hrefOf("REFERRAL_GRANTED")).toBe("/mypage");
  });

  it("紹介された人の初回公開で、チケットと通知がそろって残る", async () => {
    const referrer = await createUser("紹介する人");
    const guest = await createUser("紹介された人");
    userIds.push(referrer.id, guest.id);
    await prisma.user.update({
      where: { id: guest.id },
      data: { referredByUserId: referrer.id },
    });
    const draft = await seedEvent({ userId: guest.id, role: "OWNER", status: "DRAFT" });
    eventIds.push(draft.id);

    await publishDraftEvent(guest.id, draft.id);

    expect(await prisma.freeTicket.count({ where: { userId: referrer.id } })).toBe(2);
    const rows = await prisma.notification.findMany({ where: { userId: referrer.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("REFERRAL_GRANTED");
    // 通知は公開のあとに作られる。催しの ID は持たない。
    expect(rows[0].eventId).toBeNull();
  });
});
