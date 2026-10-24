import { describe, expect, it } from "vitest";
import { currentMonthBounds, formatDateJa, formatDateTimeJa, formatMonthJa, isoDate, yen, yenMark } from "@/lib/format";

describe("yen / yenMark", () => {
  it("3桁区切りで円を付ける", () => {
    expect(yen(0)).toBe("0円");
    expect(yen(3000)).toBe("3,000円");
    expect(yen(1234567)).toBe("1,234,567円");
  });

  it("記号付きは ¥ を頭に置く", () => {
    expect(yenMark(0)).toBe("¥0");
    expect(yenMark(1234)).toBe("¥1,234");
  });
});

describe("formatDateJa / formatMonthJa", () => {
  it("保存形式の日付を見出しにする", () => {
    expect(formatDateJa("2026-10-22")).toBe("10月22日（木）");
    expect(formatDateJa("2026-11-08")).toBe("11月8日（日）");
  });

  it("月は年を付ける", () => {
    expect(formatMonthJa("2026-10")).toBe("2026年10月");
    expect(formatMonthJa("2027-01")).toBe("2027年1月");
  });

  it("壊れた値はそのまま返す", () => {
    expect(formatDateJa("2026/10/22")).toBe("2026/10/22");
    expect(formatMonthJa("2026")).toBe("2026");
  });
});

describe("formatDateTimeJa", () => {
  it("日時を日本語の表記にする", () => {
    expect(formatDateTimeJa("2026-10-22T09:05:00")).toBe("2026/10/22 9:05:00");
  });

  it("Date も受け取る", () => {
    expect(formatDateTimeJa(new Date("2026-10-22T09:05:00"))).toBe("2026/10/22 9:05:00");
  });
});

describe("isoDate / currentMonthBounds", () => {
  it("UTC の年月日から保存形式を作る", () => {
    expect(isoDate(2026, 9, 1)).toBe("2026-10-01");
    expect(isoDate(2026, 10, 0)).toBe("2026-10-31");
  });

  it("日本時間の今月を 1 日から末日までにする", () => {
    expect(currentMonthBounds(new Date("2026-10-24T09:00:00.000Z"))).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("UTC の月末でも、日本時間で翌月なら翌月を返す", () => {
    expect(currentMonthBounds(new Date("2026-10-31T15:30:00.000Z"))).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });
});
