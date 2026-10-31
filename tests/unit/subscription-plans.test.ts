import { afterEach, describe, expect, it } from "vitest";
import {
  FREE_EVENT_LIMIT,
  SERVICE_PLANS,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
  buildServicePlans,
} from "@/modules/billing/lib/plans";
import {
  campaignAppliesTo,
  listPriceFor,
  pricingKindOfPlan,
  quoteAll,
  type CampaignDefinition,
} from "@/modules/billing/lib/pricing";
import { jstToday, quotaSourceOf } from "@/modules/billing/lib/quota";

function campaign(target: CampaignDefinition["target"]): CampaignDefinition {
  return {
    id: "c1",
    name: "テスト",
    target,
    discountKind: "PERCENT",
    percent: 20,
    startsAt: new Date("2026-10-01T00:00:00.000Z"),
    endsAt: new Date("2026-12-01T00:00:00.000Z"),
    priority: 0,
    isEnabled: true,
    stoppedAt: null,
    version: 1,
    freePerUserLimit: 1,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

describe("定額プランの価格", () => {
  it("月額で8件まで公開プランは980円、公開し放題は2980円", () => {
    expect(SUBSCRIPTION_8_PRICE_JPY).toBe(980);
    expect(SUBSCRIPTION_UNLIMITED_PRICE_JPY).toBe(2980);
    expect(listPriceFor("SUBSCRIPTION_8")).toBe(980);
    expect(listPriceFor("SUBSCRIPTION_UNLIMITED")).toBe(2980);
    expect(listPriceFor("ONE_TIME")).toBe(299);
  });

  it("料金ページの札は4枚で、公開し放題を勧める", () => {
    const plans = buildServicePlans(quoteAll([], new Date()));
    expect(plans).toHaveLength(4);
    expect(plans.map((plan) => plan.id)).toEqual([
      "free",
      "single",
      "subscription-8",
      "subscription-unlimited",
    ]);
    expect(plans.find((plan) => plan.recommended)?.id).toBe("subscription-unlimited");
    expect(plans.every((plan) => plan.priceYen === plan.listPriceYen)).toBe(true);
    expect(SERVICE_PLANS.map((plan) => plan.id)).toEqual(plans.map((plan) => plan.id));
  });

  it("公開し放題の札は「公開し放題」で、公開中のイベント数が無制限だと分かる", () => {
    const unlimited = buildServicePlans(quoteAll([], new Date())).find(
      (plan) => plan.id === "subscription-unlimited",
    );
    expect(unlimited?.name).toBe("公開し放題");
    expect(unlimited?.priceYen).toBe(2980);
    expect(unlimited?.highlights).toContain("公開中のイベント数が無制限");
  });

  it("8件プランの札は、公開中のイベントを数えると分かる", () => {
    const eight = buildServicePlans(quoteAll([], new Date())).find(
      (plan) => plan.id === "subscription-8",
    );
    expect(eight?.name).toBe("月額で8件まで公開プラン");
    expect(eight?.body).toContain("公開中のイベント");
    expect(eight?.body).toContain("終わったものは数えません");
  });
});

describe("契約と販売商品の対応", () => {
  it("定額プランから販売商品を引ける", () => {
    expect(pricingKindOfPlan("MONTHLY_8")).toBe("SUBSCRIPTION_8");
    expect(pricingKindOfPlan("UNLIMITED")).toBe("SUBSCRIPTION_UNLIMITED");
  });
});

describe("キャンペーンの適用対象", () => {
  it("旧来の SUBSCRIPTION は定額プランの両方に効く", () => {
    const target = campaign("SUBSCRIPTION");
    expect(campaignAppliesTo(target, "SUBSCRIPTION_8")).toBe(true);
    expect(campaignAppliesTo(target, "SUBSCRIPTION_UNLIMITED")).toBe(true);
    expect(campaignAppliesTo(target, "ONE_TIME")).toBe(false);
  });

  it("プラン指定は、そのプランだけに効く", () => {
    const eight = campaign("SUBSCRIPTION_8");
    expect(campaignAppliesTo(eight, "SUBSCRIPTION_8")).toBe(true);
    expect(campaignAppliesTo(eight, "SUBSCRIPTION_UNLIMITED")).toBe(false);
    const unlimited = campaign("SUBSCRIPTION_UNLIMITED");
    expect(campaignAppliesTo(unlimited, "SUBSCRIPTION_UNLIMITED")).toBe(true);
    expect(campaignAppliesTo(unlimited, "SUBSCRIPTION_8")).toBe(false);
  });

  it("BOTH はすべてに効く", () => {
    const both = campaign("BOTH");
    expect(campaignAppliesTo(both, "ONE_TIME")).toBe(true);
    expect(campaignAppliesTo(both, "SUBSCRIPTION_8")).toBe(true);
    expect(campaignAppliesTo(both, "SUBSCRIPTION_UNLIMITED")).toBe(true);
  });
});

describe("公開中のイベントの数え方", () => {
  it("今日（JST）は日本時間の 0 時を、UTC 0 時の Date で返す", () => {
    // 2026-10-31T14:59:59Z は JST で 10月31日 23:59。
    expect(jstToday(new Date("2026-10-31T14:59:59.000Z")).toISOString()).toBe(
      "2026-10-31T00:00:00.000Z",
    );
    // 2026-10-31T15:00:00Z は JST で 11月1日 0:00。
    expect(jstToday(new Date("2026-10-31T15:00:00.000Z")).toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });

  it("消費した枠は、数える側（SUBSCRIPTION）と数えない側に分かれる", () => {
    expect(quotaSourceOf("SUBSCRIPTION_MONTHLY_8")).toBe("SUBSCRIPTION");
    expect(quotaSourceOf("SUBSCRIPTION_UNLIMITED")).toBe("SUBSCRIPTION");
    // 単発と無料枠は枠の外。8 件が埋まっていても足せる。
    expect(quotaSourceOf("PAID_CREDIT")).toBe("PAID_CREDIT");
    expect(quotaSourceOf("FREE_TRIAL")).toBe("FREE_TRIAL");
  });

  it("無料枠の上限は 2 回、8 件プランの上限は 8 件", () => {
    expect(FREE_EVENT_LIMIT).toBe(2);
    expect(SUBSCRIPTION_PUBLISHED_EVENT_LIMIT).toBe(8);
  });
});

describe("Stripe の Price と加入プランの対応", () => {
  const KEYS = [
    "STRIPE_PRICE_ID_MONTHLY_8",
    "STRIPE_PRICE_ID_UNLIMITED",
    "STRIPE_PRICE_ID_MONTHLY_980",
    "STRIPE_PRICE_ID_MONTHLY_980_LEGACY",
  ] as const;
  const before = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });

  it("Price ID から加入プランを引く", async () => {
    process.env.STRIPE_PRICE_ID_MONTHLY_8 = "price_eight";
    process.env.STRIPE_PRICE_ID_UNLIMITED = "price_unlimited";
    delete process.env.STRIPE_PRICE_ID_MONTHLY_980;
    delete process.env.STRIPE_PRICE_ID_MONTHLY_980_LEGACY;
    const { planForPriceId } = await import("@/modules/billing/lib/billing");
    expect(planForPriceId("price_eight")).toBe("MONTHLY_8");
    expect(planForPriceId("price_unlimited")).toBe("UNLIMITED");
    expect(planForPriceId("price_unknown")).toBeNull();
    expect(planForPriceId(null)).toBeNull();
  });

  it("旧980円の Price は公開し放題として引き継ぐ", async () => {
    process.env.STRIPE_PRICE_ID_MONTHLY_8 = "price_eight";
    process.env.STRIPE_PRICE_ID_UNLIMITED = "price_unlimited";
    process.env.STRIPE_PRICE_ID_MONTHLY_980 = "price_legacy";
    delete process.env.STRIPE_PRICE_ID_MONTHLY_980_LEGACY;
    const { planForPriceId } = await import("@/modules/billing/lib/billing");
    expect(planForPriceId("price_legacy")).toBe("UNLIMITED");
  });
});
