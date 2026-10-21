import { describe, expect, it } from "vitest";
import { isRegisterRequired, isSessionExpired, problemMessage } from "@/lib/problem";
import { isEventId } from "@/lib/ids";

describe("isRegisterRequired", () => {
  it("REGISTER_REQUIRED だけを会員登録の要求として扱う", () => {
    expect(isRegisterRequired({ error: "REGISTER_REQUIRED" })).toBe(true);
    expect(isRegisterRequired({ error: "PHONE_REQUIRED" })).toBe(false);
    expect(isRegisterRequired({})).toBe(false);
  });
});

describe("isSessionExpired", () => {
  it("401 をログインし直しの合図として扱う", () => {
    expect(isSessionExpired({ status: 401 })).toBe(true);
    expect(isSessionExpired({ status: 403, error: "REGISTER_REQUIRED" })).toBe(false);
    expect(isSessionExpired({ status: 500 })).toBe(false);
    expect(isSessionExpired({})).toBe(false);
  });
});

describe("problemMessage", () => {
  it("detail を優先し、無ければ error、最後は既定文", () => {
    expect(problemMessage({ detail: "詳細", error: "CODE" })).toBe("詳細");
    expect(problemMessage({ error: "CODE" })).toBe("CODE");
    expect(problemMessage({}, "失敗しました")).toBe("失敗しました");
  });
});

describe("isEventId", () => {
  it("UUID だけを受け付ける", () => {
    expect(isEventId("21069a74-e30e-423b-ba38-847a86973dfe")).toBe(true);
    expect(isEventId("21069A74-E30E-423B-BA38-847A86973DFE")).toBe(true);
    expect(isEventId("not-a-uuid")).toBe(false);
    expect(isEventId("")).toBe(false);
    expect(isEventId(null)).toBe(false);
    expect(isEventId(undefined)).toBe(false);
  });
});
