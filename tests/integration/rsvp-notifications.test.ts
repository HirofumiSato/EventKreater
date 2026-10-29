import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { notifyRsvpSubmitted } from "@/modules/notifications/lib/notify";
import { GET as getNotifications, PATCH as patchNotifications } from "@/app/api/v1/notifications/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * 参加表明の通知を実際の DB へ書く。作成の判定・宛先・二重作成の防止は
 * `tests/unit/rsvp-notification.test.ts` が見ているので、ここでは
 * 「誰の行が増えるか」「既読が自分の分だけか」を確かめる。
 */

async function createUser(name: string) {
  return prisma.user.create({
    data: { email: uniqueEmail("rsvp-notification"), name },
  });
}

async function createParticipant(input: {
  eventId: string;
  name: string;
  status: "ATTENDING" | "DECLINED" | "WAITLISTED";
  userId?: string | null;
}) {
  return prisma.participant.create({
    data: {
      eventId: input.eventId,
      userId: input.userId ?? null,
      name: input.name,
      status: input.status,
      rsvpTokenHash: sha256(`${input.eventId}:${input.name}:${Math.random()}`),
    },
  });
}

function tokenFor(user: { id: string; email: string }) {
  return signLocalToken({ userId: user.id, email: user.email });
}

async function notify(input: {
  eventId: string;
  eventTitle?: string;
  participant: { id: string; name: string; userId: string | null };
  created?: boolean;
  previousStatus?: "ATTENDING" | "DECLINED" | "WAITLISTED" | null;
  nextStatus?: "ATTENDING" | "DECLINED" | "WAITLISTED";
  changedAt?: Date;
}) {
  return notifyRsvpSubmitted({
    eventId: input.eventId,
    eventTitle: input.eventTitle ?? "テスト用イベント",
    participantId: input.participant.id,
    participantName: input.participant.name,
    participantUserId: input.participant.userId,
    created: input.created ?? true,
    previousStatus: input.previousStatus ?? null,
    nextStatus: input.nextStatus ?? "ATTENDING",
    changedAt: input.changedAt ?? new Date(),
  });
}

describeDb("参加表明の通知（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("オーナーと共同幹事の 2 人に作られ、ゲスト主催者には作られない", async () => {
    const owner = await createUser("オーナー");
    const cohost = await createUser("共同幹事");
    userIds.push(owner.id, cohost.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: cohost.id, role: "CO_HOST" },
    });
    // 未登録の幹事。通知の宛先（user_id）を持たない。
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, role: "CO_HOST", guestTokenHash: sha256("guest-token") },
    });
    const participant = await createParticipant({
      eventId: event.id,
      name: "参加者A",
      status: "ATTENDING",
    });

    const created = await notify({ eventId: event.id, participant });

    expect(created).toBe(2);
    const rows = await prisma.notification.findMany({ where: { eventId: event.id } });
    expect(rows.map((row) => row.userId).sort()).toEqual([owner.id, cohost.id].sort());
    expect(rows.every((row) => row.kind === "RSVP_ATTENDING")).toBe(true);
    expect(rows[0].body).toContain("参加者A");
    expect(rows[0].title).toBe("参加表明がありました");
    expect(rows[0].readAt).toBeNull();
  });

  it("自分が主催する催しに自分で出欠すると、他の主催者にだけ作られる", async () => {
    const owner = await createUser("オーナー");
    const cohost = await createUser("共同幹事");
    userIds.push(owner.id, cohost.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: cohost.id, role: "CO_HOST" },
    });
    const participant = await createParticipant({
      eventId: event.id,
      name: "オーナー",
      status: "ATTENDING",
      userId: owner.id,
    });

    await notify({ eventId: event.id, participant });

    const rows = await prisma.notification.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(cohost.id);
  });

  it("同じ行・同じ変化で 2 回呼んでも増えない", async () => {
    const owner = await createUser("オーナー");
    userIds.push(owner.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    const participant = await createParticipant({
      eventId: event.id,
      name: "参加者B",
      status: "WAITLISTED",
    });
    const changedAt = new Date("2026-10-29T10:00:00.000Z");
    const input = {
      eventId: event.id,
      participant,
      nextStatus: "WAITLISTED" as const,
      changedAt,
    };

    expect(await notify(input)).toBe(1);
    expect(await notify(input)).toBe(0);
    expect(await prisma.notification.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("参加要望は RSVP_WAITLISTED、出席は RSVP_ATTENDING", async () => {
    const owner = await createUser("オーナー");
    userIds.push(owner.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    const attending = await createParticipant({
      eventId: event.id,
      name: "出席する人",
      status: "ATTENDING",
    });
    const waiting = await createParticipant({
      eventId: event.id,
      name: "要望する人",
      status: "WAITLISTED",
    });

    await notify({ eventId: event.id, participant: attending });
    await notify({ eventId: event.id, participant: waiting, nextStatus: "WAITLISTED" });

    const rows = await prisma.notification.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.kind).sort()).toEqual(["RSVP_ATTENDING", "RSVP_WAITLISTED"]);
    const waitlisted = rows.find((row) => row.kind === "RSVP_WAITLISTED");
    expect(waitlisted?.body).toContain("名簿から承認できます");
  });

  it("既読は自分の行だけ変わり、他の会員の未読数は変わらない", async () => {
    const owner = await createUser("オーナー");
    const cohost = await createUser("共同幹事");
    userIds.push(owner.id, cohost.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: cohost.id, role: "CO_HOST" },
    });
    const participant = await createParticipant({
      eventId: event.id,
      name: "参加者C",
      status: "ATTENDING",
    });
    await notify({ eventId: event.id, participant });

    // どちらも 1 件ずつ未読を持つ。
    const ownerGet = await getJson(await tokenFor(owner));
    const cohostGet = await getJson(await tokenFor(cohost));
    expect(ownerGet.status).toBe(200);
    expect(ownerGet.body.unreadCount).toBe(1);
    expect(cohostGet.body.unreadCount).toBe(1);
    expect(ownerGet.body.notifications).toHaveLength(1);
    expect(ownerGet.body.notifications[0].href).toBe(
      `/organizer/events/${event.id}/participants`,
    );

    // オーナーがすべて既読にしても、共同幹事の未読は残る。
    const patched = await patchJson(await tokenFor(owner), { all: true });
    expect(patched.status).toBe(200);
    expect(patched.body.unreadCount).toBe(0);
    expect((await getJson(await tokenFor(cohost))).body.unreadCount).toBe(1);
  });

  it("他の会員の通知は一覧に出ず、ID を指定しても既読にできない", async () => {
    const owner = await createUser("オーナー");
    const cohost = await createUser("共同幹事");
    userIds.push(owner.id, cohost.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: cohost.id, role: "CO_HOST" },
    });
    const participant = await createParticipant({
      eventId: event.id,
      name: "参加者D",
      status: "ATTENDING",
    });
    await notify({ eventId: event.id, participant });

    const ownerRow = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id } });
    const cohostGet = await getJson(await tokenFor(cohost));
    expect(cohostGet.body.notifications.map((row: { id: string }) => row.id)).not.toContain(
      ownerRow.id,
    );

    const patched = await patchJson(await tokenFor(cohost), { ids: [ownerRow.id] });
    expect(patched.status).toBe(200);
    expect((await getJson(await tokenFor(owner))).body.unreadCount).toBe(1);
  });

  it("未ログインでは取得も既読もできない", async () => {
    const response = await getNotifications(new NextRequest("http://localhost/api/v1/notifications"));
    expect(response.status).toBe(401);

    const patch = await patchNotifications(
      new NextRequest("http://localhost/api/v1/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      }),
    );
    expect(patch.status).toBe(401);
  });

  async function getJson(token: string) {
    const response = await getNotifications(
      new NextRequest("http://localhost/api/v1/notifications?limit=10", {
        headers: { cookie: `auth_token=${token}` },
      }),
    );
    return { status: response.status, body: (await response.json()) as NotificationsBody };
  }

  async function patchJson(token: string, body: unknown) {
    const response = await patchNotifications(
      new NextRequest("http://localhost/api/v1/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: `auth_token=${token}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as { unreadCount: number } };
  }
});

interface NotificationsBody {
  unreadCount: number;
  notifications: {
    id: string;
    kind: string;
    title: string;
    body: string;
    eventId: string;
    participantId: string | null;
    href: string;
    readAt: string | null;
    createdAt: string;
  }[];
}

