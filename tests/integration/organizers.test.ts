import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  acceptInvitation,
  createInvitation,
  previewInvitation,
} from "@/modules/organizers/lib/invitations";
import { ProblemDetailException } from "@/lib/exceptions";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function createUser() {
  return prisma.user.create({
    data: { email: uniqueEmail("organizers"), name: "共同主催の会員" },
  });
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
});
