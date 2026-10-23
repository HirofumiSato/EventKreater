import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signLocalToken } from "@/modules/auth/lib/auth";
import {
  deleteVenueSuggestion,
  listVenueSuggestions,
  rememberVenue,
  venueOwnerKeyForToken,
  venueOwnerKeyForUser,
} from "@/modules/events/lib/venue-suggestions";
import { uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const VENUE = {
  venueName: "結合テスト会場",
  postalCode: "150-0001",
  prefecture: "東京都",
  city: "渋谷区",
  town: "神宮前",
  addressLine: "1-2-3",
  building: "テストビル3F",
};

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/venues", { headers });
}

/** 会場の候補と、テストで作った会員を消す。 */
async function cleanup(ownerKeys: string[], userIds: string[]): Promise<void> {
  if (ownerKeys.length > 0) {
    await prisma.venueSuggestion.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

describeDb("過去の会場の候補（結合）", () => {
  const ownerKeys: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup(ownerKeys, userIds);
    ownerKeys.length = 0;
    userIds.length = 0;
  });

  it("未登録の幹事は、この端末の候補として覚えて次回そのまま選べる", async () => {
    const cookie = await rememberVenue(request(), VENUE);
    expect(cookie?.issueCookie).toBe(true);
    const rawToken = cookie!.rawToken;
    ownerKeys.push(venueOwnerKeyForToken(rawToken));

    const first = await listVenueSuggestions(request({ cookie: `venue_owner=${rawToken}` }));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      venueName: VENUE.venueName,
      postalCode: "1500001",
      location: "結合テスト会場 東京都渋谷区神宮前1-2-3 テストビル3F",
    });

    // 同じ会場を空白違いで入れ直しても行は増えず、最後に使った日時だけが進む。
    const ownerKey = venueOwnerKeyForToken(rawToken);
    await prisma.venueSuggestion.updateMany({
      where: { ownerKey },
      data: { lastUsedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    await rememberVenue(request({ cookie: `venue_owner=${rawToken}` }), {
      ...VENUE,
      venueName: `  ${VENUE.venueName} `,
      postalCode: "1500001",
    });

    const rows = await prisma.venueSuggestion.findMany({ where: { ownerKey } });
    expect(rows).toHaveLength(1);
    expect(rows[0].lastUsedAt.getTime()).toBeGreaterThan(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
  });

  it("会員の候補は本人にだけ見え、他人の候補は削除できない", async () => {
    const owner = await prisma.user.create({
      data: { email: uniqueEmail("venue-owner"), name: "会場の持ち主" },
    });
    const other = await prisma.user.create({
      data: { email: uniqueEmail("venue-other"), name: "別の会員" },
    });
    userIds.push(owner.id, other.id);
    ownerKeys.push(venueOwnerKeyForUser(owner.id), venueOwnerKeyForUser(other.id));

    const ownerToken = await signLocalToken({ userId: owner.id, email: owner.email });
    const otherToken = await signLocalToken({ userId: other.id, email: other.email });

    await rememberVenue(request({ cookie: `auth_token=${ownerToken}` }), VENUE);

    const mine = await listVenueSuggestions(request({ cookie: `auth_token=${ownerToken}` }));
    expect(mine).toHaveLength(1);
    expect(mine[0].venueName).toBe(VENUE.venueName);

    const theirs = await listVenueSuggestions(request({ cookie: `auth_token=${otherToken}` }));
    expect(theirs).toEqual([]);

    await expect(
      deleteVenueSuggestion(request({ cookie: `auth_token=${otherToken}` }), mine[0].id),
    ).resolves.toBe(false);

    // 本人が消すと一覧からも消える。
    const otherTokenRequest = request({ cookie: `auth_token=${ownerToken}` });
    await expect(deleteVenueSuggestion(otherTokenRequest, mine[0].id)).resolves.toBe(true);
    await expect(
      listVenueSuggestions(request({ cookie: `auth_token=${ownerToken}` })),
    ).resolves.toEqual([]);
  });
});
