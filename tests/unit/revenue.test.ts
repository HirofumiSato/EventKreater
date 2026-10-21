import { describe, expect, it } from "vitest";
import {
  averageRevenue,
  groupByPlan,
  groupBySchedule,
  summarizeRevenue,
  type RevenueParticipant,
} from "@/modules/revenue/lib/revenue";
import { keepPriceSnapshot } from "@/modules/events/lib/events";

function attending(priceAmount: number | null, extra?: Partial<RevenueParticipant>): RevenueParticipant {
  return {
    status: "ATTENDING",
    priceAmount,
    pricePlanName: priceAmount === null ? null : "一般",
    priceAudience: priceAmount === null ? null : "ANY",
    scheduleId: "schedule-1",
    ...extra,
  };
}

function declined(): RevenueParticipant {
  return {
    status: "DECLINED",
    priceAmount: null,
    pricePlanName: null,
    priceAudience: null,
    scheduleId: null,
  };
}

describe("summarizeRevenue", () => {
  it("出席者のプラン金額を足す", () => {
    const summary = summarizeRevenue([attending(3000), attending(2500)]);
    expect(summary.expectedRevenue).toBe(5500);
    expect(summary.attendingCount).toBe(2);
    expect(summary.paidAttendingCount).toBe(2);
    expect(summary.averagePerAttendee).toBe(2750);
  });

  it("不参加は売上にも人数にも含めない", () => {
    const summary = summarizeRevenue([attending(3000), declined(), declined()]);
    expect(summary.expectedRevenue).toBe(3000);
    expect(summary.attendingCount).toBe(1);
    expect(summary.declinedCount).toBe(2);
  });

  it("プラン未選択の出席者は人数だけ数え、売上には足さない", () => {
    const summary = summarizeRevenue([attending(3000), attending(null)]);
    expect(summary.expectedRevenue).toBe(3000);
    expect(summary.attendingCount).toBe(2);
    expect(summary.paidAttendingCount).toBe(1);
    expect(summary.unassignedPlanCount).toBe(1);
    // 平均は金額の分かる人だけで割る。
    expect(summary.averagePerAttendee).toBe(3000);
  });

  it("無料プランは件数に入り、小計は0円になる", () => {
    const summary = summarizeRevenue([attending(0), attending(0), attending(2000)]);
    expect(summary.expectedRevenue).toBe(2000);
    expect(summary.paidAttendingCount).toBe(3);
    expect(summary.unassignedPlanCount).toBe(0);
  });

  it("出席者がいなければ平均は0で、0除算しない", () => {
    const summary = summarizeRevenue([declined()]);
    expect(summary.expectedRevenue).toBe(0);
    expect(summary.averagePerAttendee).toBe(0);
  });

  it("領収書発行額と差額を出す", () => {
    const summary = summarizeRevenue([attending(3000), attending(3000)], [{ amount: 3000 }]);
    expect(summary.issuedRevenue).toBe(3000);
    expect(summary.receiptCount).toBe(1);
    expect(summary.unreconciled).toBe(3000);
  });

  it("領収書が多くても差額はマイナスで返す", () => {
    const summary = summarizeRevenue([attending(1000)], [{ amount: 3000 }]);
    expect(summary.unreconciled).toBe(-2000);
  });
});

describe("averageRevenue", () => {
  it("四捨五入する", () => {
    expect(averageRevenue(1000, 3)).toBe(333);
    expect(averageRevenue(1001, 3)).toBe(334);
  });

  it("0人のときは0", () => {
    expect(averageRevenue(0, 0)).toBe(0);
    expect(averageRevenue(5000, 0)).toBe(0);
  });
});

describe("groupByPlan", () => {
  it("対象とプラン名が同じ行をまとめる", () => {
    const rows = groupByPlan([
      attending(3000),
      attending(3000),
      attending(3000, { pricePlanName: "学生", priceAudience: "MALE" }),
    ]);
    expect(rows).toHaveLength(2);
    const general = rows.find((row) => row.name === "一般");
    expect(general).toMatchObject({ audience: "ANY", amount: 3000, attendingCount: 2, subtotal: 6000 });
    const student = rows.find((row) => row.name === "学生");
    expect(student).toMatchObject({ audience: "MALE", attendingCount: 1, subtotal: 3000 });
  });

  it("男女別は同じプラン名でも別の行になる", () => {
    const rows = groupByPlan([
      attending(3000, { pricePlanName: "一般", priceAudience: "MALE" }),
      attending(2500, { pricePlanName: "一般", priceAudience: "FEMALE" }),
    ]);
    expect(rows.map((row) => `${row.audience}:${row.amount}`)).toEqual(["FEMALE:2500", "MALE:3000"]);
  });

  it("途中で金額を変えた場合は別の行として残す", () => {
    const rows = groupByPlan([attending(3000), attending(3500)]);
    expect(rows.map((row) => row.amount).sort()).toEqual([3000, 3500]);
  });

  it("プラン未選択と不参加は含めない", () => {
    expect(groupByPlan([attending(null), declined()])).toEqual([]);
  });

  it("無料プランも行として残す", () => {
    const rows = groupByPlan([attending(0, { pricePlanName: "無料", priceAudience: "ANY" })]);
    expect(rows).toEqual([
      { name: "無料", audience: "ANY", amount: 0, attendingCount: 1, subtotal: 0 },
    ]);
  });
});

describe("groupBySchedule", () => {  it("開催回ごとに人数と小計を出す", () => {
    const rows = groupBySchedule([
      attending(3000, { scheduleId: "a" }),
      attending(2000, { scheduleId: "a" }),
      attending(3000, { scheduleId: "b" }),
      declined(),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.scheduleId === "a")).toMatchObject({
      attendingCount: 2,
      subtotal: 5000,
    });
    expect(rows.find((row) => row.scheduleId === "b")).toMatchObject({
      attendingCount: 1,
      subtotal: 3000,
    });
  });

  it("日時が消えた出席者は null の行にまとめる", () => {
    const rows = groupBySchedule([attending(3000, { scheduleId: null })]);
    expect(rows).toEqual([{ scheduleId: null, attendingCount: 1, subtotal: 3000 }]);
  });

  it("プラン未選択でも人数には数える", () => {
    const rows = groupBySchedule([attending(null, { scheduleId: "a" })]);
    expect(rows).toEqual([{ scheduleId: "a", attendingCount: 1, subtotal: 0 }]);
  });
});

describe("keepPriceSnapshot", () => {
  const current = {
    pricePlanId: "plan-1",
    priceAmount: 3000,
    pricePlanName: "一般",
    priceAudience: "ANY" as const,
  };

  it("同じプランなら申込時点の金額を保つ", () => {
    expect(
      keepPriceSnapshot(current, {
        pricePlanId: "plan-1",
        priceAmount: 5000,
        pricePlanName: "一般（改定）",
        priceAudience: "ANY",
      }),
    ).toEqual({ priceAmount: 3000, pricePlanName: "一般", priceAudience: "ANY" });
  });

  it("プランを変えたら今の金額を写す", () => {
    expect(
      keepPriceSnapshot(current, {
        pricePlanId: "plan-2",
        priceAmount: 2000,
        pricePlanName: "学生",
        priceAudience: "MALE",
      }),
    ).toEqual({ priceAmount: 2000, pricePlanName: "学生", priceAudience: "MALE" });
  });

  it("欠席から出席へ戻したときは今の金額を写す", () => {
    const declinedPlan = {
      pricePlanId: null,
      priceAmount: null,
      pricePlanName: null,
      priceAudience: null,
    };
    expect(
      keepPriceSnapshot(declinedPlan, {
        pricePlanId: "plan-1",
        priceAmount: 5000,
        pricePlanName: "一般",
        priceAudience: "ANY",
      }),
    ).toEqual({ priceAmount: 5000, pricePlanName: "一般", priceAudience: "ANY" });
  });

  it("不参加にしたら金額を落とす", () => {
    expect(
      keepPriceSnapshot(current, {
        pricePlanId: null,
        priceAmount: null,
        pricePlanName: null,
        priceAudience: null,
      }),
    ).toEqual({ priceAmount: null, pricePlanName: null, priceAudience: null });
  });

  it("金額スナップショットが無い行は今の金額で埋める", () => {
    expect(
      keepPriceSnapshot(
        { ...current, priceAmount: null },
        { pricePlanId: "plan-1", priceAmount: 5000, pricePlanName: "一般", priceAudience: "ANY" },
      ),
    ).toEqual({ priceAmount: 5000, pricePlanName: "一般", priceAudience: "ANY" });
  });
});
