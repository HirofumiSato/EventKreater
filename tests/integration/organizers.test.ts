import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { signLocalToken } from "@/modules/auth/lib/auth";
import {
  acceptInvitation,
  createInvitation,
  previewInvitation,
} from "@/modules/organizers/lib/invitations";
import { ProblemDetailException } from "@/lib/exceptions";
import { DELETE as deleteOrganizer } from "@/app/api/v1/organizer/events/[id]/organizers/[organizerId]/route";
import { GET as getOrganizerEvents } from "@/app/api/v1/organizer/events/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function createUser(name = "共同主催の会員") {
  return prisma.user.create({
    data: { email: uniqueEmail("organizers"), name },
  });
}

function tokenFor(user: { id: string; email: string }) {
  return signLocalToken({ userId: user.id, email: user.email });
}

describeDb("共同主催の招待（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("プレビューに主催者名と共同主催の人数を含める", async () => {
    const owner = await createUser();
    userIds.push(owner.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    const created = await createInvitation(event.id);

    const preview = await previewInvitation(created.inviteCode);

    expect(preview.event.organizer.ownerName).toBe("共同主催の会員");
    expect(preview.event.organizer.coHostCount).toBe(0);
  });

  it("ゲストの表示名を主催者名として返す", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.eventOrganizer.updateMany({
      where: { eventId: event.id },
      data: { displayName: "山田 太郎" },
    });
    const created = await createInvitation(event.id);

    const preview = await previewInvitation(created.inviteCode);

    expect(preview.event.organizer.ownerName).toBe("山田 太郎");
  });

  it("未登録の端末は REGISTER_REQUIRED で受諾できない", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    const created = await createInvitation(event.id);

    await expect(
      acceptInvitation(created.inviteCode, { userId: null, guestTokenHash: null, role: null }),
    ).rejects.toMatchObject({ status: 403 });

    const invitation = await prisma.eventInvitation.findFirst({
      where: { eventId: event.id },
      select: { isRevoked: true },
    });
    expect(invitation?.isRevoked).toBe(false);
  });

  it("会員は共同主催として参加でき、招待は一度で無効になる", async () => {
    const owner = await createUser();
    const guest = await createUser();
    userIds.push(owner.id, guest.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    const created = await createInvitation(event.id);

    const result = await acceptInvitation(created.inviteCode, {
      userId: guest.id,
      guestTokenHash: null,
      role: null,
    });

    expect(result.role).toBe("CO_HOST");
    expect(result.manageUrl).toBe(`/organizer/events/${event.id}/edit`);
    const rows = await prisma.eventOrganizer.findMany({ where: { eventId: event.id } });
    expect(rows.filter((row) => row.role === "CO_HOST")).toHaveLength(1);

    await expect(
      acceptInvitation(created.inviteCode, { userId: guest.id, guestTokenHash: null, role: null }),
    ).rejects.toBeInstanceOf(ProblemDetailException);
  });

  it("受諾すると、受諾者以外の会員幹事に COHOST_JOINED が 1 件ずつ付く", async () => {
    const owner = await createUser("主催者");
    const existing = await createUser("先に居た幹事");
    const guest = await createUser("受諾する会員");
    userIds.push(owner.id, existing.id, guest.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: existing.id, role: "CO_HOST" },
    });
    const created = await createInvitation(event.id);

    await acceptInvitation(created.inviteCode, {
      userId: guest.id,
      guestTokenHash: null,
      role: null,
    });

    const rows = await prisma.notification.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([owner.id, existing.id].sort());
    expect(rows.every((row) => row.kind === "COHOST_JOINED")).toBe(true);
    expect(rows.every((row) => row.title === "共同主催が加わりました")).toBe(true);
    const ownerRow = rows.find((row) => row.userId === owner.id);
    expect(ownerRow?.body).toContain("受諾する会員");
    expect(ownerRow?.body).toContain("テスト用イベント");
    // 受諾した本人には、自分の受諾を知らせない。
    expect(rows.some((row) => row.userId === guest.id)).toBe(false);
  });

  it("ゲスト幹事には通知行を作らず、会員の幹事にだけ作る", async () => {
    const owner = await createUser("主催者");
    const guest = await createUser("受諾する会員");
    userIds.push(owner.id, guest.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, role: "CO_HOST", guestTokenHash: sha256("guest-token") },
    });
    const created = await createInvitation(event.id);

    await acceptInvitation(created.inviteCode, {
      userId: guest.id,
      guestTokenHash: null,
      role: null,
    });

    const rows = await prisma.notification.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(owner.id);
    expect(rows[0].kind).toBe("COHOST_JOINED");
  });

  it("既に幹事の会員が受諾しても、通知は増えない", async () => {
    const owner = await createUser("主催者");
    const member = await createUser("既に幹事の会員");
    userIds.push(owner.id, member.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: member.id, role: "CO_HOST" },
    });
    const created = await createInvitation(event.id);

    await acceptInvitation(created.inviteCode, {
      userId: member.id,
      guestTokenHash: null,
      role: null,
    });

    expect(await prisma.notification.count({ where: { eventId: event.id } })).toBe(0);
    expect(
      await prisma.eventOrganizer.count({ where: { eventId: event.id, role: "CO_HOST" } }),
    ).toBe(1);
  });

  it("解除すると、外れた本人と残る幹事に COHOST_REMOVED が付き、行為者には付かない", async () => {
    const owner = await createUser("主催者");
    const removed = await createUser("外れる幹事");
    const remaining = await createUser("残る幹事");
    userIds.push(owner.id, removed.id, remaining.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    const removedRow = await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: removed.id, role: "CO_HOST" },
    });
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: remaining.id, role: "CO_HOST" },
    });

    const response = await deleteOrganizer(
      new NextRequest(
        `http://localhost/api/v1/organizer/events/${event.id}/organizers/${removedRow.id}`,
        {
          method: "DELETE",
          headers: { cookie: `auth_token=${await tokenFor(owner)}` },
        },
      ),
      { params: { id: event.id, organizerId: removedRow.id } },
    );

    expect(response.status).toBe(200);
    const rows = await prisma.notification.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId).sort()).toEqual([removed.id, remaining.id].sort());
    expect(rows.every((row) => row.kind === "COHOST_REMOVED")).toBe(true);

    // 外れた本人には自分の名前を三人称で書かず、外れたことだけを伝える。
    const selfRow = rows.find((row) => row.userId === removed.id);
    expect(selfRow?.body).toBe("「テスト用イベント」の共同主催・幹事から外れました。");
    const otherRow = rows.find((row) => row.userId === remaining.id);
    expect(otherRow?.body).toBe(
      "外れる幹事さんが「テスト用イベント」の共同主催・幹事から外れました。",
    );
    // 解除した主催者には、自分の操作を知らせない。
    expect(rows.some((row) => row.userId === owner.id)).toBe(false);
  });

  it("共同主催のイベントは主催一覧に CO_HOST として出る", async () => {
    const owner = await createUser("主催者");
    const cohost = await createUser("共同主催");
    userIds.push(owner.id, cohost.id);
    const event = await seedEvent({ userId: owner.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.eventOrganizer.create({
      data: { eventId: event.id, userId: cohost.id, role: "CO_HOST" },
    });

    const response = await getOrganizerEvents(
      new NextRequest("http://localhost/api/v1/organizer/events", {
        headers: { cookie: `auth_token=${await tokenFor(cohost)}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: { id: string; role: string }[];
      viewer: { userId: string | null };
    };
    expect(body.viewer.userId).toBe(cohost.id);
    expect(body.events.find((row) => row.id === event.id)?.role).toBe("CO_HOST");
  });
});
