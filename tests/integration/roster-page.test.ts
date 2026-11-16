import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { loadRosterForPage } from "@/modules/participants/lib/roster";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const SCHEDULE_DATE = new Date("2026-12-05T00:00:00.000Z");

describeDb("名簿の画面の権限（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  async function member(name: string) {
    const created = await prisma.user.create({
      data: { email: uniqueEmail("roster-page"), name },
    });
    userIds.push(created.id);
    return created;
  }

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("幹事の会員は名簿を読める（ok）", async () => {
    const owner = await member("幹事");
    const event = await seedEvent({
      userId: owner.id,
      scheduleDates: [SCHEDULE_DATE],
    });
    eventIds.push(event.id);
    await prisma.participant.create({
      data: {
        eventId: event.id,
        rsvpTokenHash: sha256(randomUUID()),
        name: "参加者",
        status: "ATTENDING",
        partySize: 2,
      },
    });

    // 会員のセッションだけで幹事と分かり、名簿まで 1 クエリで返る。
    const result = await loadRosterForPage(event.id, { userId: owner.id, guestTokenHashes: [] });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.event.id).toBe(event.id);
    expect(result.data.event.title).toBe(event.title);
    expect(result.data.stats.attendingCount).toBe(2);
    expect(result.data.participants.map((row) => row.name)).toEqual(["参加者"]);
  });

  it("幹事でない会員は forbidden になる", async () => {
    const owner = await member("幹事");
    const stranger = await member("第三者");
    const event = await seedEvent({ userId: owner.id });
    eventIds.push(event.id);

    const result = await loadRosterForPage(event.id, {
      userId: stranger.id,
      guestTokenHashes: [],
    });

    expect(result).toEqual({ status: "forbidden" });
  });

  it("身元が無い（未ログイン・Cookie 無し）は forbidden になる", async () => {
    const owner = await member("幹事");
    const event = await seedEvent({ userId: owner.id });
    eventIds.push(event.id);

    const result = await loadRosterForPage(event.id, { userId: null, guestTokenHashes: [] });

    expect(result).toEqual({ status: "forbidden" });
  });

  it("ゲスト幹事は register-required になる", async () => {
    const guestToken = randomUUID();
    const event = await seedEvent({ guestTokenHash: sha256(guestToken) });
    eventIds.push(event.id);

    const result = await loadRosterForPage(event.id, {
      userId: null,
      guestTokenHashes: [sha256(guestToken)],
    });

    expect(result).toEqual({ status: "register-required" });
  });

  it("削除済みの催しは、会員の幹事なら not-found・ゲストなら register-required になる", async () => {
    const owner = await member("幹事");
    const deleted = await seedEvent({ userId: owner.id, isDeleted: true });
    eventIds.push(deleted.id);

    expect(
      await loadRosterForPage(deleted.id, { userId: owner.id, guestTokenHashes: [] }),
    ).toEqual({ status: "not-found" });

    // ゲスト幹事は名簿より先に会員登録の案内へ送る（今までと同じ出し分け）。
    const guestToken = randomUUID();
    const guestDeleted = await seedEvent({
      guestTokenHash: sha256(guestToken),
      isDeleted: true,
    });
    eventIds.push(guestDeleted.id);

    expect(
      await loadRosterForPage(guestDeleted.id, {
        userId: null,
        guestTokenHashes: [sha256(guestToken)],
      }),
    ).toEqual({ status: "register-required" });
  });
});
