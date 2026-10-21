import { describe, expect, it } from "vitest";
import { isEligibleReferrer } from "@/modules/events/lib/referrer";

describe("isEligibleReferrer", () => {
  it("公開中・受付停止のイベントは参照元にできる", () => {
    expect(isEligibleReferrer({ isDeleted: false, status: "PUBLISHED" })).toBe(true);
    expect(isEligibleReferrer({ isDeleted: false, status: "CLOSED" })).toBe(true);
  });

  it("下書きは参照元にしない", () => {
    expect(isEligibleReferrer({ isDeleted: false, status: "DRAFT" })).toBe(false);
  });

  it("削除済みは状態にかかわらず参照元にしない", () => {
    expect(isEligibleReferrer({ isDeleted: true, status: "PUBLISHED" })).toBe(false);
    expect(isEligibleReferrer({ isDeleted: true, status: "CLOSED" })).toBe(false);
  });

  it("見つからない ID は参照元にしない", () => {
    expect(isEligibleReferrer(null)).toBe(false);
    expect(isEligibleReferrer(undefined)).toBe(false);
  });
});
