import { describe, expect, it } from "vitest";
import { createdEventBody } from "@/modules/events/lib/events";

/** 応答の組み立てだけを見るため、DB の全列は持たない最小の行を渡す。 */
function eventRecord(status: "DRAFT" | "PUBLISHED") {
  const date = new Date("2026-12-01T00:00:00.000Z");
  return {
    id: "e8a93b4c-9f82-4c28-9721-6b8c4d29a581",
    title: "下書きの復元",
    sortDate: date,
    location: "テスト会場",
    rainPolicy: "RAIN_OR_SHINE",
    capacity: null,
    status,
    visibility: "UNLISTED",
    rsvpDeadline: null,
    createdAt: new Date("2026-10-22T00:00:00.000Z"),
    flyerAssetId: null,
    schedules: [
      {
        id: "s1",
        eventId: "e8a93b4c-9f82-4c28-9721-6b8c4d29a581",
        eventDate: date,
        startTime: "19:00",
        endTime: "21:00",
        eventTime: "19:00〜21:00",
        sortOrder: 0,
      },
    ],
    pricePlans: [
      {
        id: "p1",
        eventId: "e8a93b4c-9f82-4c28-9721-6b8c4d29a581",
        name: "一般",
        audience: "ANY",
        amount: 3000,
        note: null,
        sortOrder: 0,
      },
    ],
    flyerAsset: null,
  };
}

function createdBody(status: "DRAFT" | "PUBLISHED") {
  // 応答の組み立ては一部の列しか読まない。DB の全列を用意せず、読む列だけを渡す。
  const row = eventRecord(status) as unknown as Parameters<typeof createdEventBody>[0];
  return createdEventBody(row);
}

/**
 * 下書きには告知ページが無い。カードや管理画面が 404 のリンクを出さないよう、
 * 作成の応答では公開 URL を返さない。
 */
describe("作成の応答", () => {
  it("下書きは公開 URL を返さず、ゲスト幹事トークンも出さない", () => {
    const body = createdBody("DRAFT");
    expect(body.event.status).toBe("DRAFT");
    expect(body.publicUrl).toBeNull();
    expect(body.guestOrganizerToken).toBeNull();
    expect(body.manageUrl).toBe(`/organizer/events/${body.event.id}`);
  });

  it("公開済みは告知 URL を返す", () => {
    const body = createdBody("PUBLISHED");
    expect(body.publicUrl).toBe(`/events/${body.event.id}`);
  });

  /**
   * 作成は会員だけが行える。未登録の幹事トークンは発行しないが、
   * 応答の形は変えず null を返して、古いクライアントを壊さない。
   */
  it("公開済みでもゲスト幹事トークンは返さない", () => {
    expect(createdBody("PUBLISHED").guestOrganizerToken).toBeNull();
  });
});
