import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupPostalCode,
  resetPostalCodeSearch,
  shouldAutoSearchPostalCode,
} from "@/modules/events/lib/postal-code-search";

const RESULT = { prefecture: "東京都", city: "世田谷区", town: "三宿" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  resetPostalCodeSearch();
  vi.unstubAllGlobals();
});

describe("自動検索を始める条件", () => {
  it("7 桁がそろい、前回と違うコードなら引く", () => {
    expect(shouldAutoSearchPostalCode("", "1540005")).toBe(true);
    expect(shouldAutoSearchPostalCode("1500001", "1540005")).toBe(true);
  });

  it("同じコードでは引き直さない", () => {
    expect(shouldAutoSearchPostalCode("1540005", "1540005")).toBe(false);
    expect(shouldAutoSearchPostalCode("1540005", "154-0005")).toBe(false);
  });

  it("7 桁に満たない間は引かない", () => {
    expect(shouldAutoSearchPostalCode("", "154000")).toBe(false);
    expect(shouldAutoSearchPostalCode("", "")).toBe(false);
  });

  it("全角の数字でも 7 桁なら引く", () => {
    expect(shouldAutoSearchPostalCode("", "１５４０００５")).toBe(true);
  });
});

describe("郵便番号の検索", () => {
  it("7 桁なら住所を引く", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ results: [RESULT] }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(lookupPostalCode("1540005")).resolves.toEqual([RESULT]);
    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/geo/postal-codes/1540005");
  });

  it("7 桁に満たなければ通信しない", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(lookupPostalCode("154")).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("同じコードは控えから返し、通信は 1 回だけ", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ results: [RESULT] }));
    vi.stubGlobal("fetch", fetchSpy);

    await lookupPostalCode("1540005");
    await lookupPostalCode("154-0005");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("同時に引いても通信は 1 回にまとめる", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ results: [RESULT] }));
    vi.stubGlobal("fetch", fetchSpy);

    const [first, second] = await Promise.all([
      lookupPostalCode("1540005"),
      lookupPostalCode("1540005"),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("失敗は文言ごと投げ、控えない", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ title: "Not Found", detail: "見つかりませんでした。" }, 404),
      )
      .mockResolvedValueOnce(jsonResponse({ results: [RESULT] }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(lookupPostalCode("1540005")).rejects.toThrow("見つかりませんでした。");
    await expect(lookupPostalCode("1540005")).resolves.toEqual([RESULT]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
