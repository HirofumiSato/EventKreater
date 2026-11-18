import { describe, expect, it } from "vitest";
import type { UserQuota } from "@/modules/events/types";
import { hasUnlimitedGrant } from "@/modules/billing/lib/grant";
import { publishConfirmation } from "@/modules/billing/lib/publish-confirm";

const NOW = new Date("2026-11-02T00:00:00.000Z");
const FUTURE = "2026-12-02T00:00:00.000Z";

function quota(overrides: Partial<UserQuota> = {}): UserQuota {
  return {
    freeEventCount: 0,
    freeLimit: 2,
    remainingFree: 2,
    paidCredits: 0,
    subscriptionStatus: "NONE",
    subscriptionPlan: "NONE",
    currentPeriodEnd: null,
    canCreate: true,
    planType: "NONE",
    ...overrides,
  };
}

function tickets(available: number): UserQuota["tickets"] {
  return {
    available,
    expiringAt: null,
    ad: { nextGrantAt: null },
    referral: { code: null, grantedCount: 0, limit: 10 },
  };
}

describe("運営付与の判定", () => {
  it("grantedPlan が UNLIMITED のときだけ、公開し放題の付与とみなす", () => {
    expect(hasUnlimitedGrant({ grantedPlan: "UNLIMITED" })).toBe(true);
    expect(hasUnlimitedGrant({ grantedPlan: "MONTHLY_8" })).toBe(false);
    expect(hasUnlimitedGrant({ grantedPlan: "NONE" })).toBe(false);
    expect(hasUnlimitedGrant({ grantedPlan: null })).toBe(false);
  });

  it("grantedPlan を持たない行・クォータが無いときは付与なし", () => {
    expect(hasUnlimitedGrant({})).toBe(false);
    expect(hasUnlimitedGrant(null)).toBe(false);
    expect(hasUnlimitedGrant(undefined)).toBe(false);
  });
});

describe("運営付与中の公開の確認", () => {
  it("付与中は、チケットや単発を持っていても確認を出さない", () => {
    const granted = quota({
      grantedUnlimited: true,
      tickets: tickets(2),
      paidCredits: 3,
      planType: "SUBSCRIPTION_UNLIMITED",
    });
    expect(publishConfirmation(granted, NOW)).toBeNull();
  });

  it("支払いに問題があっても、付与中なら確認を出さない", () => {
    // 付与は PAST_DUE より先に見る。サーバーも同じ順で公開を通す。
    const granted = quota({
      grantedUnlimited: true,
      subscriptionStatus: "PAST_DUE",
      subscriptionPlan: "UNLIMITED",
      currentPeriodEnd: FUTURE,
      tickets: tickets(1),
      paidCredits: 1,
      planType: "SUBSCRIPTION_UNLIMITED",
    });
    expect(publishConfirmation(granted, NOW)).toBeNull();
  });

  it("付与が無ければ、これまでどおりチケットの確認を出す", () => {
    const released = quota({
      grantedUnlimited: false,
      tickets: tickets(2),
      remainingFree: 1,
      planType: "PAID_CREDIT",
    });
    expect(publishConfirmation(released, NOW)).toEqual({
      kind: "FREE_TICKET",
      remaining: 2,
      remainingAfter: 1,
    });
  });
});
