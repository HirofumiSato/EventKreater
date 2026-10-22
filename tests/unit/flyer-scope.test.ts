import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventOrganizer: { findFirst: mocks.findFirst },
  },
}));

import { resolveFlyerQuotaScope } from "@/modules/flyers/lib/scope";

const DRAFT_KEY = "11111111-2222-4333-8444-555555555555";
const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/flyers/quota", { headers });
}

beforeEach(() => {
  mocks.findFirst.mockReset();
});

describe("resolveFlyerQuotaScope", () => {
  it("eventId が無ければ公開前の下書きとして扱う", async () => {
    const scope = await resolveFlyerQuotaScope(request(), DRAFT_KEY, null);
    expect(scope).toEqual({ draftKey: DRAFT_KEY, eventId: null });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("そのイベントの幹事でなければ 403", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(
      resolveFlyerQuotaScope(request(), DRAFT_KEY, EVENT_ID),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("ゲスト幹事のトークンでもイベント枠を使える", async () => {
    mocks.findFirst.mockResolvedValue({ role: "CO_HOST" });
    const scope = await resolveFlyerQuotaScope(
      request({ "x-organizer-token": "guest-token" }),
      DRAFT_KEY,
      EVENT_ID,
    );
    expect(scope).toEqual({ draftKey: DRAFT_KEY, eventId: EVENT_ID });
  });
});
