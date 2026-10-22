import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { todayInTokyo } from "@/lib/calendar";
import { GET } from "@/app/api/v1/public/organizers/[userId]/events/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

// JWT の署名鍵は本番と同じ長さを要求されるので、テスト用に満たしておく。
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "integration-test-secret-key-0123456789";
}

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 今日から days 日後（日本時間）の `YYYY-MM-DD`。 */
function futureDate(days: number): string {
  const base = new Date(`${todayInTokyo()}T00:00:00.000Z`);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function createUser(name: string) {
  return prisma.user.create({
    data: { email: uniqueEmail("public-organizer"), name },
  });
}

async function addSchedule(eventId: string, date: string, time = "10:00", sortOrder = 0) {
  return prisma.eventSchedule.create({
    data: {
      eventId,
      eventDate: new Date(`${date}T00:00:00.000Z`),
      eventTime: time,
      startTime: "10:00",
      endTime: "12:00",
      sortOrder,
    },
  });
}

function request(userId: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/public/organizers/${userId}/events`, {
    headers: token ? { cookie: `auth_token=${token}` } : {},
  });
}

async function callRoute(userId: string, token?: string) {
  const response = await GET(request(userId, token), { params: { userId } });
  return { status: response.status, body: await response.json() };
}

describeDb("主催者の公開ページ API（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("未ログインは 403 で催しを返さない", async () => {
    const organizer = await createUser("未ログイン確認の主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    await addSchedule(event.id, futureDate(7));

    const { status, body } = await callRoute(organizer.id);

    expect(status).toBe(403);
    expect(body.error).toBe("LOGIN_REQUIRED");
    expect(body.events).toBeUndefined();
  });

  it("存在しない主催者は 404 にする", async () => {
    const viewer = await createUser("閲覧する参加者");
    userIds.push(viewer.id);
    const token = await signLocalToken({ userId: viewer.id, email: viewer.email });

    const { status } = await callRoute("00000000-0000-4000-8000-000000000000", token);

    expect(status).toBe(404);
  });

  it("退会した主催者は 404 にする", async () => {
    const organizer = await createUser("退会した主催者");
    const viewer = await createUser("閲覧する参加者");
    userIds.push(organizer.id, viewer.id);
    await prisma.user.update({ where: { id: organizer.id }, data: { deletedAt: new Date() } });
    const token = await signLocalToken({ userId: viewer.id, email: viewer.email });

    const { status } = await callRoute(organizer.id, token);

    expect(status).toBe(404);
  });

  it("筆頭幹事と共同主催の催しを、掲載条件を満たすものだけ返す", async () => {
    const organizer = await createUser("掲載確認の主催者");
    const other = await createUser("別の主催者");
    const viewer = await createUser("閲覧する参加者");
    userIds.push(organizer.id, other.id, viewer.id);

    const ownerEvent = await seedEvent({ userId: organizer.id, role: "OWNER" });
    const coHostEvent = await seedEvent({ userId: organizer.id, role: "CO_HOST" });
    const draftEvent = await seedEvent({ userId: organizer.id, role: "OWNER" });
    const closedEvent = await seedEvent({ userId: organizer.id, role: "OWNER" });
    const pastEvent = await seedEvent({ userId: organizer.id, role: "OWNER" });
    const deletedEvent = await seedEvent({ userId: organizer.id, role: "OWNER", isDeleted: true });
    const otherEvent = await seedEvent({ userId: other.id, role: "OWNER" });
    eventIds.push(
      ownerEvent.id,
      coHostEvent.id,
      draftEvent.id,
      closedEvent.id,
      pastEvent.id,
      deletedEvent.id,
      otherEvent.id,
    );

    await addSchedule(ownerEvent.id, futureDate(10));
    await addSchedule(coHostEvent.id, futureDate(3));
    await addSchedule(draftEvent.id, futureDate(5));
    await addSchedule(closedEvent.id, futureDate(5));
    await addSchedule(pastEvent.id, futureDate(-3));
    await addSchedule(deletedEvent.id, futureDate(5));
    await addSchedule(otherEvent.id, futureDate(5));
    await prisma.event.update({ where: { id: draftEvent.id }, data: { status: "DRAFT" } });
    await prisma.event.update({
      where: { id: closedEvent.id },
      data: { rsvpDeadline: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const token = await signLocalToken({ userId: viewer.id, email: viewer.email });
    const { status, body } = await callRoute(organizer.id, token);

    expect(status).toBe(200);
    expect(body.organizer).toEqual({ userId: organizer.id, name: organizer.name });
    expect(body.events.map((row: { id: string }) => row.id)).toEqual([coHostEvent.id, ownerEvent.id]);
  });

  it("開催日を YYYY-MM-DD と表示用の時刻で返す", async () => {
    const organizer = await createUser("日付確認の主催者");
    const viewer = await createUser("閲覧する参加者");
    userIds.push(organizer.id, viewer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const date = futureDate(4);
    await addSchedule(event.id, date);
    await prisma.event.update({
      where: { id: event.id },
      data: { sortDate: new Date(`${date}T00:00:00.000Z`) },
    });

    const token = await signLocalToken({ userId: viewer.id, email: viewer.email });
    const { body } = await callRoute(organizer.id, token);

    expect(body.events[0].sortDate).toBe(date);
    expect(body.events[0].schedules).toHaveLength(1);
    expect(body.events[0].schedules[0]).toMatchObject({
      eventDate: date,
      eventTime: "10:00〜12:00",
    });
  });

  it("候補日が複数あれば、近い日で並べる", async () => {
    const organizer = await createUser("複数日確認の主催者");
    const viewer = await createUser("閲覧する参加者");
    userIds.push(organizer.id, viewer.id);
    const later = await seedEvent({ userId: organizer.id, role: "OWNER" });
    const sooner = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(later.id, sooner.id);
    await addSchedule(later.id, futureDate(20));
    await addSchedule(sooner.id, futureDate(2));
    await addSchedule(sooner.id, futureDate(30), "18:00", 1);

    const token = await signLocalToken({ userId: viewer.id, email: viewer.email });
    const { body } = await callRoute(organizer.id, token);

    expect(body.events.map((row: { id: string }) => row.id)).toEqual([sooner.id, later.id]);
    expect(body.events[0].schedules).toHaveLength(2);
  });

  it("満員なら参加要望を受け付け、参加要望の人数は出席に数えない", async () => {
    const organizer = await createUser("満員確認の主催者");
    const viewer = await createUser("閲覧する参加者");
    userIds.push(organizer.id, viewer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    await addSchedule(event.id, futureDate(6));
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 2 } });
    await prisma.participant.createMany({
      data: [
        { eventId: event.id, rsvpTokenHash: `hash-a-${event.id}`, name: "出席A", status: "ATTENDING" },
        { eventId: event.id, rsvpTokenHash: `hash-b-${event.id}`, name: "出席B", status: "ATTENDING" },
        { eventId: event.id, rsvpTokenHash: `hash-c-${event.id}`, name: "欠席C", status: "DECLINED" },
        {
          eventId: event.id,
          rsvpTokenHash: `hash-d-${event.id}`,
          name: "要望D",
          status: "WAITLISTED",
          waitlistedAt: new Date(),
        },
      ],
    });

    const token = await signLocalToken({ userId: viewer.id, email: viewer.email });
    const { body } = await callRoute(organizer.id, token);

    expect(body.events[0]).toMatchObject({
      capacity: 2,
      attendingCount: 2,
      remainingSeats: 0,
      isFull: true,
      acceptsWaitlist: true,
      rsvpOpen: true,
    });
  });

  it("受付を締め切った催しは返さない", async () => {
    const organizer = await createUser("締切確認の主催者");
    const viewer = await createUser("閲覧する参加者");
    userIds.push(organizer.id, viewer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    await addSchedule(event.id, futureDate(6));
    await prisma.event.update({
      where: { id: event.id },
      data: { rsvpDeadline: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const token = await signLocalToken({ userId: viewer.id, email: viewer.email });
    const { body } = await callRoute(organizer.id, token);

    expect(body.events).toEqual([]);
  });
});
