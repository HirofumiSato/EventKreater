import { describe, expect, it } from "vitest";
import { shiftDateByMonths } from "@/modules/events/lib/clone";

describe("shiftDateByMonths", () => {
  it("月末は、ずらした月の末日へ丸める", () => {
    expect(shiftDateByMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftDateByMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(shiftDateByMonths("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("閏年の2月は29日に丸める", () => {
    expect(shiftDateByMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("年を跨いでも月だけをずらす", () => {
    expect(shiftDateByMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftDateByMonths("2027-01-15", -1)).toBe("2026-12-15");
  });

  it("月の末日でない日は、その日のままずらす", () => {
    expect(shiftDateByMonths("2026-11-08", 1)).toBe("2026-12-08");
    expect(shiftDateByMonths("2026-02-28", 1)).toBe("2026-03-28");
  });

  it("同月（0か月）は同じ日付を返す", () => {
    expect(shiftDateByMonths("2026-11-08", 0)).toBe("2026-11-08");
    expect(shiftDateByMonths("2026-01-31", 0)).toBe("2026-01-31");
  });

  it("形の違う値は計算せず、そのまま返す", () => {
    expect(shiftDateByMonths("2026-11", 1)).toBe("2026-11");
    expect(shiftDateByMonths("", 1)).toBe("");
  });
});
