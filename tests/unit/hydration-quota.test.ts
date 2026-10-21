import { describe, expect, it } from "vitest";
import { mergedFreeEventCount } from "@/modules/auth/lib/hydrate";
import { FREE_EVENT_LIMIT } from "@/modules/billing/lib/quota";

describe("mergedFreeEventCount", () => {
  it("移行した筆頭幹事の数だけ無料枠が増える", () => {
    expect(mergedFreeEventCount(0, 1)).toBe(1);
    expect(mergedFreeEventCount(1, 1)).toBe(FREE_EVENT_LIMIT);
  });

  it("上限を超えない", () => {
    expect(mergedFreeEventCount(FREE_EVENT_LIMIT, 3)).toBe(FREE_EVENT_LIMIT);
  });

  it("移行が無ければ変えない", () => {
    expect(mergedFreeEventCount(1, 0)).toBe(1);
  });

  it("負の値や不正な値は 0 として扱う", () => {
    expect(mergedFreeEventCount(-1, 1)).toBe(1);
    expect(mergedFreeEventCount(Number.NaN, 1)).toBe(1);
    expect(mergedFreeEventCount(0, Number.NaN)).toBe(0);
  });
});
