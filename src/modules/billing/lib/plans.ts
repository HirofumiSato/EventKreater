export const FREE_EVENT_LIMIT = 2;
export const ONE_TIME_PRICE_JPY = 299;
export const SUBSCRIPTION_PRICE_JPY = 980;

export interface ServicePlan {
  id: "free" | "single" | "subscription";
  name: string;
  priceYen: number;
  unit: string;
  body: string;
  /** 割引前の定価。割引中だけ priceYen と違う。 */
  listPriceYen: number;
  discountPercent: number;
  campaignName: string | null;
  campaignEndsAt: string | null;
}

/** 画面に出すときだけ使う、価格キャンペーン適用後の金額。 */
export interface PlanQuote {
  listPrice: number;
  chargedPrice: number;
  discountPercent: number;
  campaignName: string | null;
  campaignEndsAt: string | null;
}

function planFrom(id: "free" | "single" | "subscription", name: string, unit: string, body: string, priceYen: number): ServicePlan {
  return {
    id,
    name,
    priceYen,
    unit,
    body,
    listPriceYen: priceYen,
    discountPercent: 0,
    campaignName: null,
    campaignEndsAt: null,
  };
}

export const SERVICE_PLANS: readonly ServicePlan[] = [
  planFrom("free", "無料", `最初の${FREE_EVENT_LIMIT}回`, `イベントの公開を、累計${FREE_EVENT_LIMIT}回まで料金なしで試せます。`, 0),
  planFrom("single", "単発チケット", "1回", "必要なときだけ1回分を足します。たまに開く人向けです。", ONE_TIME_PRICE_JPY),
  planFrom("subscription", "月額", "月", "契約が有効なあいだ、イベント作成の回数は数えません。", SUBSCRIPTION_PRICE_JPY),
];

/** 料金ページ用。定価はそのまま、割引中のものだけ金額を差し替える。 */
export function buildServicePlans(quotes: {
  oneTime: PlanQuote;
  subscription: PlanQuote;
}): ServicePlan[] {
  const apply = (plan: ServicePlan, quote: PlanQuote): ServicePlan => ({
    ...plan,
    priceYen: quote.chargedPrice,
    listPriceYen: quote.listPrice,
    discountPercent: quote.discountPercent,
    campaignName: quote.campaignName,
    campaignEndsAt: quote.campaignEndsAt,
  });
  return SERVICE_PLANS.map((plan) => {
    if (plan.id === "single") return apply(plan, quotes.oneTime);
    if (plan.id === "subscription") return apply(plan, quotes.subscription);
    return plan;
  });
}
