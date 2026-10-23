import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveUserId: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    venueSuggestion: {
      findMany: mocks.findMany,
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
  },
}));

vi.mock("@/modules/auth/lib/guards", () => ({
  resolveOptionalUserId: mocks.resolveUserId,
}));

import {
  deleteVenueSuggestion,
  hasVenueAddress,
  listVenueSuggestions,
  rememberVenue,
  rememberVenueQuietly,
  venueFingerprint,
  venueOwnerKeyForToken,
  venueOwnerKeyForUser,
  VENUE_SUGGESTION_LIMIT,
} from "@/modules/events/lib/venue-suggestions";

const VENUE = {
  venueName: "○○ホール",
  postalCode: "150-0001",
  prefecture: "東京都",
  city: "渋谷区",
  town: "神宮前",
  addressLine: "1-2-3",
  building: "○○ビル3F",
};

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/venues", { headers });
}

beforeEach(() => {
  mocks.resolveUserId.mockReset();
  mocks.findMany.mockReset();
  mocks.upsert.mockReset();
  mocks.deleteMany.mockReset();
});

describe("venueFingerprint", () => {
  it("郵便番号のハイフンと前後の空白を無視して同じ指紋にする", () => {
    expect(venueFingerprint(VENUE)).toBe(
      venueFingerprint({
        ...VENUE,
        venueName: "  ○○ホール ",
        postalCode: "1500001",
        addressLine: " 1-2-3 ",
      }),
    );
  });

  it("建物名が違えば別の会場として扱う", () => {
    expect(venueFingerprint(VENUE)).not.toBe(
      venueFingerprint({ ...VENUE, building: "△△ビル5F" }),
    );
  });

  it("会場名だけでも住所として認める", () => {
    expect(hasVenueAddress({ venueName: "○○ホール" })).toBe(true);
    expect(hasVenueAddress({ venueName: "  " })).toBe(false);
    expect(hasVenueAddress({})).toBe(false);
  });
});

describe("ownerKey", () => {
  it("会員は user、未登録は端末トークンのハッシュで分ける", () => {
    expect(venueOwnerKeyForUser("user-1")).toBe("u:user-1");
    const key = venueOwnerKeyForToken("raw-token");
    expect(key).toMatch(/^d:[0-9a-f]{64}$/);
    // トークンそのものは残さない。
    expect(key).not.toContain("raw-token");
  });
});

describe("rememberVenue", () => {
  it("住所が空なら何もしない", async () => {
    mocks.resolveUserId.mockResolvedValue(null);
    await expect(rememberVenue(request(), { venueName: "  " })).resolves.toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("未登録の幹事は端末トークンを払い出し、端末の候補として覚える", async () => {
    mocks.resolveUserId.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue({});

    const cookie = await rememberVenue(request(), VENUE);

    expect(cookie).toEqual({ rawToken: expect.any(String), issueCookie: true });
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.where.ownerKey_fingerprint).toEqual({
      ownerKey: venueOwnerKeyForToken(cookie!.rawToken),
      fingerprint: venueFingerprint(VENUE),
    });
    expect(args.create).toMatchObject({ venueName: "○○ホール", postalCode: "1500001" });
  });

  it("会員は自分の候補として覚え、Cookie は払い出さない", async () => {
    mocks.resolveUserId.mockResolvedValue("user-1");
    mocks.upsert.mockResolvedValue({});

    const cookie = await rememberVenue(request(), VENUE);

    expect(cookie).toEqual({ rawToken: expect.any(String), issueCookie: false });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][0].where.ownerKey_fingerprint.ownerKey).toBe("u:user-1");
  });

  it("会員でも端末の Cookie が残っていれば、端末の候補も更新する", async () => {
    mocks.resolveUserId.mockResolvedValue("user-1");
    mocks.upsert.mockResolvedValue({});

    await rememberVenue(request({ cookie: "venue_owner=raw-token" }), VENUE);

    const ownerKeys = mocks.upsert.mock.calls.map(
      ([args]) => args.where.ownerKey_fingerprint.ownerKey,
    );
    expect(ownerKeys).toEqual(["u:user-1", venueOwnerKeyForToken("raw-token")]);
  });
});

describe("rememberVenueQuietly", () => {
  it("記録に失敗してもイベントの保存を止めない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.resolveUserId.mockResolvedValue(null);
    mocks.upsert.mockRejectedValue(new Error("db down"));

    await expect(rememberVenueQuietly(request(), VENUE)).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("listVenueSuggestions", () => {
  it("自分の候補を新しい順に返し、会員と端末の重複は1件にまとめる", async () => {
    mocks.resolveUserId.mockResolvedValue("user-1");
    mocks.findMany.mockResolvedValue([
      {
        id: "venue-1",
        ownerKey: "u:user-1",
        fingerprint: venueFingerprint(VENUE),
        ...VENUE,
        lastUsedAt: new Date("2026-10-20T00:00:00.000Z"),
      },
      {
        id: "venue-2",
        ownerKey: venueOwnerKeyForToken("raw-token"),
        fingerprint: venueFingerprint(VENUE),
        ...VENUE,
        lastUsedAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    ]);

    const venues = await listVenueSuggestions(request({ cookie: "venue_owner=raw-token" }));

    expect(venues).toHaveLength(1);
    expect(venues[0]).toMatchObject({
      id: "venue-1",
      location: "○○ホール 東京都渋谷区神宮前1-2-3 ○○ビル3F",
      lastUsedAt: "2026-10-20T00:00:00.000Z",
    });
  });

  it("会員でも端末の候補でもなければ、DB を引かずに空配列を返す", async () => {
    mocks.resolveUserId.mockResolvedValue(null);
    await expect(listVenueSuggestions(request())).resolves.toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("返す件数は上限までにする", async () => {
    mocks.resolveUserId.mockResolvedValue("user-1");
    mocks.findMany.mockResolvedValue(
      Array.from({ length: VENUE_SUGGESTION_LIMIT + 5 }, (_, index) => ({
        id: `venue-${index}`,
        ownerKey: "u:user-1",
        fingerprint: `fingerprint-${index}`,
        ...VENUE,
        venueName: `会場${index}`,
        lastUsedAt: new Date(2026, 0, index + 1),
      })),
    );

    const venues = await listVenueSuggestions(request());
    expect(venues).toHaveLength(VENUE_SUGGESTION_LIMIT);
  });
});

describe("deleteVenueSuggestion", () => {
  it("自分の候補だけを消す", async () => {
    mocks.resolveUserId.mockResolvedValue("user-1");
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    await expect(deleteVenueSuggestion(request(), "venue-1")).resolves.toBe(true);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: "venue-1", ownerKey: { in: ["u:user-1"] } },
    });
  });

  it("所有者が分からなければ消さず、見つからない扱いにする", async () => {
    mocks.resolveUserId.mockResolvedValue(null);
    await expect(deleteVenueSuggestion(request(), "venue-1")).resolves.toBe(false);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
