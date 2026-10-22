import { describe, expect, it } from "vitest";
import {
  allocateRevenue,
  equalSharesBps,
  formatShareBps,
  isAllocationConfigured,
  resolveSharesBps,
  validateAllocationRows,
  type AllocationOrganizer,
  type AllocationShare,
} from "@/modules/revenue/lib/allocation";

const three: AllocationOrganizer[] = [
  { organizerId: "owner", role: "OWNER" },
  { organizerId: "co-a", role: "CO_HOST" },
  { organizerId: "co-b", role: "CO_HOST" },
];

function shares(
  mode: "RATIO" | "HEADCOUNT",
  values: number[],
): AllocationShare[] {
  return three.map((row, index) => ({
    organizerId: row.organizerId,
    shareBps: mode === "RATIO" ? values[index] : null,
    headcount: mode === "HEADCOUNT" ? values[index] : null,
  }));
}

describe("equalSharesBps", () => {
  it("3人の均等割は 33.33 / 33.33 / 33.34 で、余りを主催者へ寄せる", () => {
    expect(equalSharesBps(three)).toEqual([3334, 3333, 3333]);
  });

  it("割り切れる人数では全員同じ", () => {
    expect(equalSharesBps(three.slice(0, 2))).toEqual([5000, 5000]);
  });

  it("主催者が1人だけなら全額", () => {
    expect(equalSharesBps([three[0]])).toEqual([10000]);
  });

  it("主催者が居ない並びでも先頭に余りを寄せる", () => {
    expect(equalSharesBps(three.slice(1))).toEqual([5000, 5000]);
  });
});

describe("resolveSharesBps", () => {
  it("保存済みの合計が 10000 ならそれを使う", () => {
    expect(resolveSharesBps(three, shares("RATIO", [5000, 3000, 2000]))).toEqual([
      5000, 3000, 2000,
    ]);
  });

  it("合計が 10000 でなければ均等割へ戻す", () => {
    expect(resolveSharesBps(three, shares("RATIO", [5000, 3000, 1000]))).toEqual([
      3334, 3333, 3333,
    ]);
  });

  it("共同主催を足した直後（行が足りない）も均等割で計算する", () => {
    const stale = shares("RATIO", [5000, 5000, 0]).slice(0, 2);
    expect(resolveSharesBps(three, stale)).toEqual([3334, 3333, 3333]);
  });
});

describe("allocateRevenue（割合方式）", () => {
  it("均等割で 3,333 / 3,334 / 3,333 円になり、合計が元の金額と一致する", () => {
    const result = allocateRevenue({
      mode: "RATIO",
      organizers: three,
      shares: [],
      expectedRevenue: 10000,
      issuedRevenue: 10000,
      attendingCount: 3,
    });
    expect(result.rows.map((row) => row.expectedRevenue)).toEqual([3334, 3333, 3333]);
    expect(result.rows.reduce((sum, row) => sum + row.expectedRevenue, 0)).toBe(10000);
    expect(result.unallocated.expectedRevenue).toBe(0);
  });

  it("50 / 30 / 20 の比率で分ける", () => {
    const result = allocateRevenue({
      mode: "RATIO",
      organizers: three,
      shares: shares("RATIO", [5000, 3000, 2000]),
      expectedRevenue: 12345,
      issuedRevenue: 8000,
      attendingCount: 3,
    });
    expect(result.rows.map((row) => row.expectedRevenue)).toEqual([6173, 3703, 2469]);
    expect(result.rows.map((row) => row.issuedRevenue)).toEqual([4000, 2400, 1600]);
  });

  it("領収書発行額も同じ配分で按分し、見込みと合計が食い違わない", () => {
    const result = allocateRevenue({
      mode: "RATIO",
      organizers: three,
      shares: [],
      expectedRevenue: 10000,
      issuedRevenue: 9999,
      attendingCount: 3,
    });
    expect(result.rows.reduce((sum, row) => sum + row.expectedRevenue, 0)).toBe(10000);
    expect(result.rows.reduce((sum, row) => sum + row.issuedRevenue, 0)).toBe(9999);
  });

  it("主催者が1人なら全額がその人に入る", () => {
    const result = allocateRevenue({
      mode: "RATIO",
      organizers: [three[0]],
      shares: [],
      expectedRevenue: 8000,
      issuedRevenue: 5000,
      attendingCount: 2,
    });
    expect(result.rows[0]).toMatchObject({ expectedRevenue: 8000, issuedRevenue: 5000 });
  });
});

describe("allocateRevenue（人数方式）", () => {
  it("出席3人を1 / 1 / 1 で分けると 3,333 / 3,334 / 3,333 円", () => {
    const result = allocateRevenue({
      mode: "HEADCOUNT",
      organizers: three,
      shares: shares("HEADCOUNT", [1, 1, 1]),
      expectedRevenue: 10000,
      issuedRevenue: 0,
      attendingCount: 3,
    });
    expect(result.rows.map((row) => row.expectedRevenue)).toEqual([3334, 3333, 3333]);
    expect(result.unallocated.headcount).toBe(0);
  });

  it("出席3人を1 / 1 / 0 で分けると、未割当 1 人・3,334 円が残る", () => {
    const result = allocateRevenue({
      mode: "HEADCOUNT",
      organizers: three,
      shares: shares("HEADCOUNT", [1, 1, 0]),
      expectedRevenue: 10000,
      issuedRevenue: 10000,
      attendingCount: 3,
    });
    expect(result.rows.map((row) => row.expectedRevenue)).toEqual([3333, 3333, 0]);
    expect(result.unallocated).toEqual({
      headcount: 1,
      expectedRevenue: 3334,
      issuedRevenue: 3334,
    });
  });

  it("18 人中 12 人を配分すると、未割当が 6 人残る", () => {
    const organizers: AllocationOrganizer[] = [
      { organizerId: "owner", role: "OWNER" },
      { organizerId: "co-a", role: "CO_HOST" },
    ];
    const result = allocateRevenue({
      mode: "HEADCOUNT",
      organizers,
      shares: [
        { organizerId: "owner", shareBps: null, headcount: 6 },
        { organizerId: "co-a", shareBps: null, headcount: 6 },
      ],
      expectedRevenue: 18000,
      issuedRevenue: 0,
      attendingCount: 18,
    });
    expect(result.unallocated.headcount).toBe(6);
    expect(result.unallocated.expectedRevenue).toBe(6000);
    expect(result.rows.reduce((sum, row) => sum + row.expectedRevenue, 0)).toBe(12000);
  });

  it("出席者が0人でも0除算せず、全員0円になる", () => {
    const result = allocateRevenue({
      mode: "HEADCOUNT",
      organizers: three,
      shares: shares("HEADCOUNT", [1, 1, 1]),
      expectedRevenue: 10000,
      issuedRevenue: 5000,
      attendingCount: 0,
    });
    expect(result.rows.every((row) => row.expectedRevenue === 0)).toBe(true);
    expect(result.unallocated).toEqual({ headcount: 0, expectedRevenue: 0, issuedRevenue: 0 });
  });

  it("出席者が減って人数の合計を超えたら、売上を超えず未割当も出ない", () => {
    const result = allocateRevenue({
      mode: "HEADCOUNT",
      organizers: three,
      shares: shares("HEADCOUNT", [3, 3, 3]),
      expectedRevenue: 9000,
      issuedRevenue: 0,
      attendingCount: 2,
    });
    expect(result.rows.reduce((sum, row) => sum + row.expectedRevenue, 0)).toBe(9000);
    expect(result.unallocated).toEqual({ headcount: 0, expectedRevenue: 0, issuedRevenue: 0 });
  });

  it("共同主催を解除すると、残った主催者だけで再計算する", () => {
    const remaining = three.slice(0, 2);
    const result = allocateRevenue({
      mode: "HEADCOUNT",
      organizers: remaining,
      shares: shares("HEADCOUNT", [1, 1, 1]),
      expectedRevenue: 10000,
      issuedRevenue: 0,
      attendingCount: 2,
    });
    expect(result.rows.map((row) => row.expectedRevenue)).toEqual([5000, 5000]);
  });
});

describe("isAllocationConfigured", () => {
  it("設定行が揃っていれば true", () => {
    expect(isAllocationConfigured("RATIO", three, shares("RATIO", [5000, 3000, 2000]))).toBe(true);
    expect(isAllocationConfigured("HEADCOUNT", three, shares("HEADCOUNT", [1, 1, 1]))).toBe(true);
  });

  it("行が足りない・合計が100%でないときは false", () => {
    expect(isAllocationConfigured("RATIO", three, [])).toBe(false);
    expect(isAllocationConfigured("RATIO", three, shares("RATIO", [5000, 3000, 1000]))).toBe(false);
  });
});

describe("validateAllocationRows", () => {
  const rows = (values: number[]) =>
    three.map((row, index) => ({
      organizerId: row.organizerId,
      shareBps: values[index],
      headcount: values[index],
    }));

  it("主催者が過不足なく揃っていれば通る", () => {
    expect(validateAllocationRows("RATIO", three, rows([5000, 3000, 2000]), 3)).toBeNull();
  });

  it("主催者が足りない・余分・他イベントの ID は ORGANIZER_SET_MISMATCH", () => {
    expect(validateAllocationRows("RATIO", three, rows([5000, 5000, 0]).slice(0, 2), 3)).toMatchObject(
      { code: "ORGANIZER_SET_MISMATCH" },
    );
    expect(
      validateAllocationRows("RATIO", three, [
        ...rows([3334, 3333, 3333]),
        { organizerId: "other-event", shareBps: 0, headcount: 0 },
      ], 3),
    ).toMatchObject({ code: "ORGANIZER_SET_MISMATCH" });
  });

  it("割合の合計が 100% でなければ SHARE_TOTAL_NOT_100", () => {
    expect(validateAllocationRows("RATIO", three, rows([5000, 3000, 1000]), 3)).toMatchObject({
      code: "SHARE_TOTAL_NOT_100",
    });
  });

  it("人数の合計が出席者数を超えると HEADCOUNT_EXCEEDS_ATTENDING", () => {
    expect(validateAllocationRows("HEADCOUNT", three, rows([10, 6, 3]), 18)).toMatchObject({
      code: "HEADCOUNT_EXCEEDS_ATTENDING",
      attendingCount: 18,
      totalHeadcount: 19,
    });
  });

  it("負数は INVALID_ALLOCATION_VALUE", () => {
    expect(validateAllocationRows("RATIO", three, rows([-1, 5001, 5000]), 3)).toMatchObject({
      code: "INVALID_ALLOCATION_VALUE",
    });
  });
});

describe("formatShareBps", () => {
  it("basis points を小数第2位までの % にする", () => {
    expect(formatShareBps(3333)).toBe("33.33");
    expect(formatShareBps(5000)).toBe("50.00");
    expect(formatShareBps(10000)).toBe("100.00");
  });
});
