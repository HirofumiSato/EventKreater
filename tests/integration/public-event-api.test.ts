import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/v1/public/events/[id]/route";
import { loadPublicEventStatic } from "@/modules/events/lib/public-event";
import { cleanup, seedEvent } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * 公開イベント API の契約。告知ページへ寄せたあとも、外から見える項目と
 * ステータスが変わっていないことを確かめる。
 *
 * 期待する項目は、寄せる前のルートが返していた 26 個をそのまま並べたもの。
 * 増やすときは `PublicEvent` とこの一覧を同じ変更で直す。
 */
const CONTRACT_KEYS = [
  "id",
  "title",
  "summary",
  "sortDate",
  "schedules",
  "pricePlans",
  "discounts",
  "location",
  "rainPolicy",
  "capacity",
  "targetGeneration",
  "themeId",
  "status",
  "visibility",
  "rsvpDeadline",
  "rsvpOpen",
  "attendingCount",
  "waitlistCount",
  "remainingSeats",
  "isFull",
  "acceptsWaitlist",
  "loggedIn",
  "viewer",
  "organizers",
  "flyerAsset",
  "myRsvp",
].sort();

function request(eventId: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/public/events/${eventId}`);
}

async function getEvent(eventId: string) {
  const res = await GET(request(eventId), { params: { id: eventId } });
  return { res, body: res.ok ? await res.json() : null };
}

describeDb("公開イベント API（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];
  const flyerIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    if (flyerIds.length > 0) {
      await prisma.flyerAsset.deleteMany({ where: { id: { in: flyerIds } } });
    }
    eventIds.length = 0;
    userIds.length = 0;
    flyerIds.length = 0;
  });

  it("公開中のイベントを、告知ページと同じ項目で 200 を返す", async () => {
    const event = await seedEvent({ scheduleDates: [new Date("2026-12-01T00:00:00.000Z")] });
    eventIds.push(event.id);

    const { res, body } = await getEvent(event.id);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(Object.keys(body).sort()).toEqual(CONTRACT_KEYS);
    expect(body).toMatchObject({
      id: event.id,
      title: "テスト用イベント",
      status: "PUBLISHED",
      visibility: "UNLISTED",
      attendingCount: 0,
      waitlistCount: 0,
      remainingSeats: null,
      isFull: false,
      acceptsWaitlist: false,
      rsvpOpen: true,
      loggedIn: false,
      viewer: {
        loggedIn: false,
        name: null,
        isThisEventsOrganizer: false,
        hasOrganizerRole: false,
      },
      myRsvp: null,
      flyerAsset: null,
    });
    expect(body.schedules).toHaveLength(1);
    expect(body.schedules[0]).toMatchObject({ eventDate: "2026-12-01" });
  });

  it("人数は出席の partySize を足し、参加要望は別に数える", async () => {
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 5 } });
    await prisma.participant.createMany({
      data: [
        { eventId: event.id, rsvpTokenHash: `${event.id}-a`, name: "出席", status: "ATTENDING", partySize: 2 },
        { eventId: event.id, rsvpTokenHash: `${event.id}-b`, name: "要望", status: "WAITLISTED" },
      ],
    });

    const { body } = await getEvent(event.id);

    expect(body).toMatchObject({
      attendingCount: 2,
      waitlistCount: 1,
      remainingSeats: 3,
      isFull: false,
      acceptsWaitlist: false,
    });
  });

  it("廃棄したチラシは、公開 API だけが今までどおり返す", async () => {
    const flyer = await prisma.flyerAsset.create({
      data: { imageUrl: "/uploads/flyers/deleted.webp", isDeleted: true },
    });
    flyerIds.push(flyer.id);
    const event = await seedEvent();
    eventIds.push(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { flyerAssetId: flyer.id } });

    const { body } = await getEvent(event.id);
    expect(body.flyerAsset).toMatchObject({ id: flyer.id, imageUrl: "/uploads/flyers/deleted.webp" });

    // 告知ページの側は出さない（同じローダーでも、既定は公開ページの見た目）。
    const pageSide = await loadPublicEventStatic(event.id);
    expect(pageSide?.flyerAsset).toBeNull();
  });

  it("下書き・削除済み・存在しない ID は 404", async () => {
    const draft = await seedEvent({ status: "DRAFT" });
    eventIds.push(draft.id);
    const deleted = await seedEvent({ isDeleted: true });
    eventIds.push(deleted.id);

    for (const id of [draft.id, deleted.id, crypto.randomUUID()]) {
      const { res } = await getEvent(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ status: 404, title: "Not Found" });
    }
  });
});
