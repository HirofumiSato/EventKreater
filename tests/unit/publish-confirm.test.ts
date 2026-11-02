import { describe, expect, it } from "vitest";
import type { UserQuota } from "@/modules/events/types";
import { publishConfirmation, remainingFor } from "@/modules/billing/lib/publish-confirm";

const NOW = new Date("2026-11-02T00:00:00.000Z");
const FUTURE = "2026-12-02T00:00:00.000Z";
const PAST = "2026-10-02T00:00:00.000Z";

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

describe("公開前の確認を出すか", () => {
  it("公開し放題のあいだは確認を出さない", () => {
    const active = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "UNLIMITED",
      currentPeriodEnd: FUTURE,
      remainingFree: 2,
      planType: "SUBSCRIPTION_UNLIMITED",
    });
    expect(publishConfirmation(active, NOW)).toBeNull();
  });

  it("月額で8件まで公開プランのあいだは確認を出さない", () => {
    const active = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: FUTURE,
      remainingFree: 2,
      planType: "SUBSCRIPTION_MONTHLY_8",
    });
    expect(publishConfirmation(active, NOW)).toBeNull();
  });

  it("定額の期限が過ぎていれば、無料チケットの確認を出す", () => {
    const expired = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: PAST,
      remainingFree: 1,
      planType: "FREE_TRIAL",
    });
    expect(publishConfirmation(expired, NOW)).toEqual({
      kind: "FREE_TRIAL",
      remaining: 1,
      remainingAfter: 0,
    });
  });

  it("期限が無い ACTIVE は定額とみなさない", () => {
    const active = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "UNLIMITED",
      currentPeriodEnd: null,
      remainingFree: 2,
      planType: "FREE_TRIAL",
    });
    expect(publishConfirmation(active, NOW)).toEqual({
      kind: "FREE_TRIAL",
      remaining: 2,
      remainingAfter: 1,
    });
  });

  it("支払いに問題があるあいだは確認を出さない", () => {
    const pastDue = quota({
      subscriptionStatus: "PAST_DUE",
      subscriptionPlan: "UNLIMITED",
      currentPeriodEnd: FUTURE,
      tickets: tickets(2),
      paidCredits: 2,
      remainingFree: 2,
      planType: "PAID_CREDIT",
    });
    expect(publishConfirmation(pastDue, NOW)).toBeNull();
  });
});

describe("月額で8件まで公開プランの上限に達したとき", () => {
  it("チケットがあれば、チケットの確認を出す", () => {
    const full = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: FUTURE,
      remainingPublished: 0,
      tickets: tickets(4),
      paidCredits: 0,
      remainingFree: 2,
      planType: "PAID_CREDIT",
    });
    expect(publishConfirmation(full, NOW)).toEqual({
      kind: "FREE_TICKET",
      remaining: 4,
      remainingAfter: 3,
    });
  });

  it("チケットが無ければ、単発クレジットの確認を出す", () => {
    const full = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: FUTURE,
      remainingPublished: 0,
      tickets: tickets(0),
      paidCredits: 3,
      remainingFree: 2,
      planType: "PAID_CREDIT",
    });
    expect(publishConfirmation(full, NOW)).toEqual({
      kind: "PAID_CREDIT",
      remaining: 3,
      remainingAfter: 2,
    });
  });

  it("チケットも単発も無ければ確認を出さない（無料チケットがあっても加入中なので使わない）", () => {
    const full = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: FUTURE,
      remainingPublished: 0,
      tickets: tickets(0),
      paidCredits: 0,
      remainingFree: 2,
      planType: "SUBSCRIPTION_MONTHLY_8",
    });
    expect(publishConfirmation(full, NOW)).toBeNull();
  });

  it("公開できる件数が残っていれば確認を出さない", () => {
    const room = quota({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: FUTURE,
      remainingPublished: 3,
      tickets: tickets(2),
      paidCredits: 2,
      remainingFree: 2,
      planType: "SUBSCRIPTION_MONTHLY_8",
    });
    expect(publishConfirmation(room, NOW)).toBeNull();
  });
});

describe("電話番号が未確認のとき", () => {
  it("未加入で無料チケットだけなら確認を出さない", () => {
    const unverified = quota({
      phoneVerified: false,
      remainingFree: 2,
      planType: "NONE",
    });
    expect(publishConfirmation(unverified, NOW)).toBeNull();
  });

  it("未加入でもチケットがあれば確認を出す（電話番号はチケットに要らない）", () => {
    const unverified = quota({
      phoneVerified: false,
      tickets: tickets(2),
      remainingFree: 2,
      planType: "PAID_CREDIT",
    });
    expect(publishConfirmation(unverified, NOW)).toEqual({
      kind: "FREE_TICKET",
      remaining: 2,
      remainingAfter: 1,
    });
  });
});

describe("使うチケットの順番", () => {
  it("チケットがあれば、単発クレジットより先にチケットを使う", () => {
    const owner = quota({
      tickets: tickets(3),
      paidCredits: 5,
      remainingFree: 2,
      planType: "PAID_CREDIT",
    });
    expect(publishConfirmation(owner, NOW)).toEqual({
      kind: "FREE_TICKET",
      remaining: 3,
      remainingAfter: 2,
    });
  });

  it("チケットが無ければ単発クレジットを使う", () => {
    const owner = quota({
      tickets: tickets(0),
      paidCredits: 4,
      remainingFree: 2,
      planType: "PAID_CREDIT",
    });
    expect(publishConfirmation(owner, NOW)).toEqual({
      kind: "PAID_CREDIT",
      remaining: 4,
      remainingAfter: 3,
    });
  });

  it("チケットも単発も無ければ無料チケットを使う", () => {
    const owner = quota({
      tickets: tickets(0),
      paidCredits: 0,
      remainingFree: 2,
      planType: "FREE_TRIAL",
    });
    expect(publishConfirmation(owner, NOW)).toEqual({
      kind: "FREE_TRIAL",
      remaining: 2,
      remainingAfter: 1,
    });
  });

  it("チケットの情報が無くても、単発クレジットへ進む", () => {
    const owner = quota({ paidCredits: 1, remainingFree: 2, planType: "PAID_CREDIT" });
    expect(publishConfirmation(owner, NOW)).toEqual({
      kind: "PAID_CREDIT",
      remaining: 1,
      remainingAfter: 0,
    });
  });
});

describe("確認を出さない場面", () => {
  it("チケットも単発も無料チケットも残っていなければ確認を出さない", () => {
    const empty = quota({ tickets: tickets(0), paidCredits: 0, remainingFree: 0 });
    expect(publishConfirmation(empty, NOW)).toBeNull();
  });

  it("クォータが分からないときは確認を出さない", () => {
    expect(publishConfirmation(null, NOW)).toBeNull();
  });
});

describe("使ったあとの残り", () => {
  it("残りが1なら0に止める（負にしない）", () => {
    const ticket = quota({ tickets: tickets(1) });
    expect(publishConfirmation(ticket, NOW)?.remainingAfter).toBe(0);
    const credit = quota({ paidCredits: 1 });
    expect(publishConfirmation(credit, NOW)?.remainingAfter).toBe(0);
    const free = quota({ remainingFree: 1 });
    expect(publishConfirmation(free, NOW)?.remainingAfter).toBe(0);
  });

  it("残りが1より多ければ、1枚減らした数を返す", () => {
    const owner = quota({ remainingFree: 5 });
    expect(publishConfirmation(owner, NOW)?.remainingAfter).toBe(4);
  });
});

describe("種類ごとのいまの残り", () => {
  it("チケットは期限つきチケットの残りを読む", () => {
    const owner = quota({ tickets: tickets(4), paidCredits: 2, remainingFree: 5 });
    expect(remainingFor(owner, "FREE_TICKET")).toBe(4);
  });

  it("単発チケットは paidCredits を読む", () => {
    const owner = quota({ tickets: tickets(4), paidCredits: 2, remainingFree: 5 });
    expect(remainingFor(owner, "PAID_CREDIT")).toBe(2);
  });

  it("無料チケットは remainingFree を読む", () => {
    const owner = quota({ tickets: tickets(4), paidCredits: 2, remainingFree: 5 });
    expect(remainingFor(owner, "FREE_TRIAL")).toBe(5);
  });

  it("チケットの情報が無ければ0を返す", () => {
    expect(remainingFor(quota(), "FREE_TICKET")).toBe(0);
  });

  it("クォータが分からないときは0を返す", () => {
    expect(remainingFor(null, "FREE_TICKET")).toBe(0);
    expect(remainingFor(null, "PAID_CREDIT")).toBe(0);
    expect(remainingFor(null, "FREE_TRIAL")).toBe(0);
  });
});
