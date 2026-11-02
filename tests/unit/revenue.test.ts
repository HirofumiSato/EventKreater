import { describe, expect, it } from "vitest";
import {
  averageRevenue,
  groupByPlan,
  groupBySchedule,
  payableAmount,
  summarizeRevenue,
  unitPayableAmount,
  type RevenueParticipant,
} from "@/modules/revenue/lib/revenue";
import { keepPriceSnapshot } from "@/modules/events/lib/events";
import { participantPriceDisplay } from "@/lib/serializers";

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

function declined(extra?: Partial<RevenueParticipant>): RevenueParticipant {
  return {
    status: "DECLINED",
    priceAmount: null,
    pricePlanName: null,
    priceAudience: null,
    scheduleId: null,
    ...extra,
  };
}

function waitlisted(extra?: Partial<RevenueParticipant>): RevenueParticipant {
  return {
    status: "WAITLISTED",
    priceAmount: null,
    pricePlanName: null,
    priceAudience: null,
    scheduleId: null,
    ...extra,
  };
}

/** 集金日時の見本。日付そのものは集計に使わない（入っているかどうかだけを見る）。 */
const COLLECTED_AT = new Date("2026-11-01T00:00:00.000Z");

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

  it("参加要望は売上にも出席・欠席の人数にも含めない", () => {
    const summary = summarizeRevenue([attending(3000), waitlisted(), waitlisted()]);
    expect(summary.expectedRevenue).toBe(3000);
    expect(summary.attendingCount).toBe(1);
    expect(summary.declinedCount).toBe(0);
    expect(summary.averagePerAttendee).toBe(3000);
    expect(groupByPlan([attending(3000), waitlisted()])).toHaveLength(1);
    expect(groupBySchedule([attending(3000), waitlisted()])).toHaveLength(1);
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

  it("出席かつ集金済みの行だけを集金に数える", () => {
    const summary = summarizeRevenue([
      attending(3000, { collectedAt: COLLECTED_AT }),
      attending(3000),
    ]);
    expect(summary.expectedRevenue).toBe(6000);
    expect(summary.collectedRevenue).toBe(3000);
    expect(summary.collectedCount).toBe(1);
    expect(summary.uncollected).toBe(3000);
  });

  it("欠席と参加要望の集金日時は数えない", () => {
    const summary = summarizeRevenue([
      attending(3000, { collectedAt: COLLECTED_AT }),
      declined({ collectedAt: COLLECTED_AT }),
      waitlisted({ collectedAt: COLLECTED_AT }),
    ]);
    expect(summary.collectedRevenue).toBe(3000);
    expect(summary.collectedCount).toBe(1);
    expect(summary.uncollected).toBe(0);
  });

  it("2 人以上の行は人数ぶんを集金に足す", () => {
    const summary = summarizeRevenue([
      attending(3000, { partySize: 3, collectedAt: COLLECTED_AT }),
    ]);
    expect(summary.expectedRevenue).toBe(9000);
    expect(summary.collectedRevenue).toBe(9000);
    expect(summary.collectedCount).toBe(3);
  });

  it("集金済みの人数は件数ではなく partySize の合計で数える", () => {
    const summary = summarizeRevenue([
      attending(3000, { partySize: 2, collectedAt: COLLECTED_AT }),
      attending(2000, { collectedAt: COLLECTED_AT }),
    ]);
    // 2 件でも 3 人。件数で数えると 2 になってしまう。
    expect(summary.collectedCount).toBe(3);
    expect(summary.collectedRevenue).toBe(8000);
  });

  it("未集金は見込みから集金を引いた額になる", () => {
    const summary = summarizeRevenue([
      attending(1000, { collectedAt: COLLECTED_AT }),
      attending(3000),
      attending(2000),
    ]);
    expect(summary.expectedRevenue).toBe(6000);
    expect(summary.collectedRevenue).toBe(1000);
    expect(summary.uncollected).toBe(5000);
  });

  it("プラン未選択は見込みにも集金にも入れず、人数にも数えない", () => {
    const summary = summarizeRevenue([
      attending(null, { partySize: 2, collectedAt: COLLECTED_AT }),
      attending(3000, { collectedAt: COLLECTED_AT }),
    ]);
    expect(summary.expectedRevenue).toBe(3000);
    expect(summary.collectedRevenue).toBe(3000);
    expect(summary.collectedCount).toBe(1);
    expect(summary.uncollected).toBe(0);
    expect(summary.unassignedPlanCount).toBe(2);
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
      { name: "無料", audience: "ANY", amount: 0, attendingCount: 1, discountSubtotal: 0, subtotal: 0 },
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
    expect(rows).toEqual([
      { scheduleId: null, attendingCount: 1, discountSubtotal: 0, subtotal: 3000 },
    ]);
  });

  it("プラン未選択でも人数には数える", () => {
    const rows = groupBySchedule([attending(null, { scheduleId: "a" })]);
    expect(rows).toEqual([
      { scheduleId: "a", attendingCount: 1, discountSubtotal: 0, subtotal: 0 },
    ]);
  });
});

describe("participantPriceDisplay", () => {
  it("申込時点の金額が残っていれば、現在のプラン金額ではなくそちらを出す", () => {
    expect(
      participantPriceDisplay({
        priceAmount: 3000,
        pricePlanName: "一般",
        priceAudience: "ANY",
        pricePlan: { name: "一般（改定）", audience: "ANY", amount: 5000 },
      }),
    ).toEqual({ label: "一般 3,000円", amount: 3000 });
  });

  it("男女別は対象を前に付ける", () => {
    expect(
      participantPriceDisplay({
        priceAmount: 2000,
        pricePlanName: "学生",
        priceAudience: "MALE",
        pricePlan: null,
      }),
    ).toEqual({ label: "男性 学生 2,000円", amount: 2000 });
  });

  it("スナップショットが無ければ現在のプランを出す", () => {
    expect(
      participantPriceDisplay({
        priceAmount: null,
        pricePlanName: null,
        priceAudience: null,
        pricePlan: { name: "一般", audience: "ANY", amount: 3000, note: "1ドリンク付" },
      }),
    ).toEqual({ label: "一般 3,000円（1ドリンク付）", amount: 3000 });
  });

  it("プランが無ければ null", () => {
    expect(
      participantPriceDisplay({
        priceAmount: null,
        pricePlanName: null,
        priceAudience: null,
        pricePlan: null,
      }),
    ).toEqual({ label: null, amount: null });
  });

  it("無料プランは0円として残す", () => {
    expect(
      participantPriceDisplay({
        priceAmount: 0,
        pricePlanName: "一般",
        priceAudience: "ANY",
        pricePlan: null,
      }),
    ).toEqual({ label: "一般 無料", amount: 0 });
  });
});

describe("参加人数ぶんの売上", () => {
  it("3 人なら人数・売上・支払額を 3 倍で数える", () => {
    const summary = summarizeRevenue([attending(3000, { partySize: 3 })]);
    expect(summary.attendingCount).toBe(3);
    expect(summary.paidAttendingCount).toBe(3);
    expect(summary.expectedRevenue).toBe(9000);
    expect(summary.averagePerAttendee).toBe(3000);
  });

  it("割引は 1 人ぶんとして、人数ぶんを引く", () => {
    const summary = summarizeRevenue([
      attending(3000, { partySize: 2, discounts: [{ amount: 500 }] }),
    ]);
    expect(summary.expectedRevenue).toBe(5000);
  });

  it("人数が省略された行は 1 人として数える", () => {
    const summary = summarizeRevenue([attending(3000), attending(3000, { partySize: 0 })]);
    expect(summary.attendingCount).toBe(2);
    expect(summary.expectedRevenue).toBe(6000);
  });

  it("プラン未選択は人数だけを足す", () => {
    const summary = summarizeRevenue([attending(null, { partySize: 4 })]);
    expect(summary.attendingCount).toBe(4);
    expect(summary.unassignedPlanCount).toBe(4);
    expect(summary.expectedRevenue).toBe(0);
  });

  it("プラン別・開催回別も人数と割引小計を人数ぶんで数える", () => {
    const planRows = groupByPlan([
      attending(3000, { partySize: 3, discounts: [{ amount: 500 }] }),
      attending(3000, { partySize: 2, discounts: [{ amount: 500 }] }),
    ]);
    expect(planRows).toEqual([
      {
        name: "一般",
        audience: "ANY",
        amount: 3000,
        attendingCount: 5,
        discountSubtotal: 2500,
        subtotal: 12500,
      },
    ]);

    const scheduleRows = groupBySchedule([
      attending(3000, { partySize: 2, scheduleId: "a", discounts: [{ amount: 500 }] }),
    ]);
    expect(scheduleRows).toEqual([
      { scheduleId: "a", attendingCount: 2, discountSubtotal: 1000, subtotal: 5000 },
    ]);
  });
});

describe("1 人ぶんの支払額", () => {
  it("人数を掛けず、割引だけを引く", () => {
    expect(unitPayableAmount({ priceAmount: 3000, discounts: [{ amount: 500 }] })).toBe(2500);
  });

  it("プラン未選択は null", () => {
    expect(unitPayableAmount({ priceAmount: null })).toBeNull();
  });

  it("割引が金額を超えても 0 円で止まる", () => {
    expect(unitPayableAmount({ priceAmount: 1000, discounts: [{ amount: 1500 }] })).toBe(0);
  });

  it("合計額は 1 人ぶんに人数を掛けた値になる", () => {
    const row = { priceAmount: 3000, discounts: [{ amount: 500 }], partySize: 3 };
    expect(unitPayableAmount(row)).toBe(2500);
    expect(payableAmount(row)).toBe(7500);
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

describe("割引後の売上", () => {
  it("見込み売上は割引を引いた支払額で数える", () => {
    const summary = summarizeRevenue([
      attending(3000, { discounts: [{ amount: 500 }] }),
      attending(2500),
    ]);
    expect(summary.expectedRevenue).toBe(5000);
    expect(summary.averagePerAttendee).toBe(2500);
  });

  it("支払額は 0 円で止め、無料より下がらない", () => {
    const summary = summarizeRevenue([
      attending(300, { discounts: [{ amount: 500 }] }),
    ]);
    expect(summary.expectedRevenue).toBe(0);
  });

  it("プラン別は割引の小計を分けて出し、支払額を小計にする", () => {
    const rows = groupByPlan([
      attending(3000, { discounts: [{ amount: 500 }] }),
      attending(3000),
    ]);
    // 割引の有無で別の行にする（同じプランでも支払額が違うため）。
    expect(rows).toHaveLength(2);
    const discounted = rows.find((row) => row.discountSubtotal === 500);
    expect(discounted).toMatchObject({
      amount: 3000,
      attendingCount: 1,
      discountSubtotal: 500,
      subtotal: 2500,
    });
  });

  it("同じ割引の組み合わせは 1 行にまとめる", () => {
    const rows = groupByPlan([
      attending(3000, { discounts: [{ amount: 500 }] }),
      attending(3000, { discounts: [{ amount: 500 }] }),
    ]);
    expect(rows).toEqual([
      {
        name: "一般",
        audience: "ANY",
        amount: 3000,
        attendingCount: 2,
        discountSubtotal: 1000,
        subtotal: 5000,
      },
    ]);
  });

  it("開催回別も割引を引いた小計にする", () => {
    const rows = groupBySchedule([
      attending(3000, { scheduleId: "a", discounts: [{ amount: 500 }] }),
    ]);
    expect(rows).toEqual([
      { scheduleId: "a", attendingCount: 1, discountSubtotal: 500, subtotal: 2500 },
    ]);
  });
});
