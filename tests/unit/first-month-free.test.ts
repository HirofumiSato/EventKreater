import { describe, expect, it } from "vitest";
import { FIRST_MONTH_FREE_MONTHS } from "@/modules/billing/lib/plans";
import { isTrialEligible, trialEndsAt, type TrialEligibilityInput } from "@/modules/billing/lib/trial";

/** 3つの条件がすべて空の、初月無料を使える会員。 */
function eligibleInput(overrides: Partial<TrialEligibilityInput> = {}): TrialEligibilityInput {
  return {
    trialUsedAt: null,
    stripeSubscriptionId: null,
    priorSubscriptions: 0,
    ...overrides,
  };
}

describe("初月無料の加入資格", () => {
  it("無料期間を使ったことも契約したことも無ければ使える", () => {
    expect(isTrialEligible(eligibleInput())).toBe(true);
    expect(FIRST_MONTH_FREE_MONTHS).toBe(1);
  });

  it("無料期間を一度でも使っていれば使えない", () => {
    expect(isTrialEligible(eligibleInput({ trialUsedAt: new Date("2026-09-01T00:00:00.000Z") }))).toBe(
      false,
    );
  });

  it("契約中のサブスクリプションがあれば使えない", () => {
    expect(isTrialEligible(eligibleInput({ stripeSubscriptionId: "sub_123" }))).toBe(false);
  });

  it("決済が済んだ月額の記録があれば、解約して再加入しても使えない", () => {
    expect(isTrialEligible(eligibleInput({ priorSubscriptions: 1 }))).toBe(false);
    expect(isTrialEligible(eligibleInput({ priorSubscriptions: 3 }))).toBe(false);
  });

  it("3つの条件が重なっても、使えないまま変わらない", () => {
    expect(
      isTrialEligible({
        trialUsedAt: new Date("2026-09-01T00:00:00.000Z"),
        stripeSubscriptionId: "sub_123",
        priorSubscriptions: 2,
      }),
    ).toBe(false);
  });
});

describe("初月無料の終了日時", () => {
  it("加入した時刻の1か月後を、同じ時刻のまま返す", () => {
    const start = new Date("2026-11-02T09:30:00.000Z");
    expect(trialEndsAt(start).toISOString()).toBe("2026-12-02T09:30:00.000Z");
  });

  it("翌月に同じ日が無いときは、その月の末日にする", () => {
    // 1月31日 → 2月28日（平年）
    expect(trialEndsAt(new Date("2026-01-31T00:00:00.000Z")).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    // 3月31日 → 4月30日
    expect(trialEndsAt(new Date("2026-03-31T00:00:00.000Z")).toISOString()).toBe(
      "2026-04-30T00:00:00.000Z",
    );
    // 8月31日 → 9月30日
    expect(trialEndsAt(new Date("2026-08-31T15:00:00.000Z")).toISOString()).toBe(
      "2026-09-30T15:00:00.000Z",
    );
  });

  it("うるう年の2月は29日まで伸ばす", () => {
    // 2028年はうるう年。
    expect(trialEndsAt(new Date("2028-01-31T00:00:00.000Z")).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    // うるう年の2月29日 → 3月29日
    expect(trialEndsAt(new Date("2028-02-29T00:00:00.000Z")).toISOString()).toBe(
      "2028-03-29T00:00:00.000Z",
    );
  });

  it("年をまたぐ加入も1か月後を返す", () => {
    expect(trialEndsAt(new Date("2026-12-31T23:59:00.000Z")).toISOString()).toBe(
      "2027-01-31T23:59:00.000Z",
    );
  });

  it("元の日時を書き換えない", () => {
    const start = new Date("2026-01-31T00:00:00.000Z");
    trialEndsAt(start);
    expect(start.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
