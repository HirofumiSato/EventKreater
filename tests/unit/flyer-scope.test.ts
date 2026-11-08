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

const EVENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/flyers/quota", { headers });
}

beforeEach(() => {
  mocks.findFirst.mockReset();
});

describe("resolveFlyerQuotaScope", () => {
  it("eventId が無ければ保存前の枠として扱う", async () => {
    const scope = await resolveFlyerQuotaScope(request(), null);
    // 数える単位はクライアントが指定しない。保存前は会員・端末から決める。
    expect(scope).toEqual({ eventId: null });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("undefined の eventId も保存前の枠として扱う", async () => {
    const scope = await resolveFlyerQuotaScope(request(), undefined);
    expect(scope).toEqual({ eventId: null });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("そのイベントの幹事でなければ 403", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(resolveFlyerQuotaScope(request(), EVENT_ID)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("ゲスト幹事のトークンでもイベント枠を使える", async () => {
    mocks.findFirst.mockResolvedValue({ role: "CO_HOST" });
    const scope = await resolveFlyerQuotaScope(
      request({ "x-organizer-token": "guest-token" }),
      EVENT_ID,
    );
    expect(scope).toEqual({ eventId: EVENT_ID });
  });
});
