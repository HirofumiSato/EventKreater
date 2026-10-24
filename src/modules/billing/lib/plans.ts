export const FREE_EVENT_LIMIT = 2;
export const ONE_TIME_PRICE_JPY = 299;
export const SUBSCRIPTION_PRICE_JPY = 980;

export interface ServicePlan {
  id: "free" | "single" | "subscription";
  name: string;
  priceYen: number;
  unit: string;
  body: string;
  /** 札の中で並べる短い約束。本文（body）より細かい、買う前の判断材料。 */
  highlights: string[];
  /** いま勧める 1 枚。札の枠を濃くするだけで、順位や金額は変えない。 */
  recommended: boolean;
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

function planFrom(
  id: "free" | "single" | "subscription",
  name: string,
  unit: string,
  body: string,
  priceYen: number,
  highlights: string[],
  recommended = false,
): ServicePlan {
  return {
    id,
    name,
    priceYen,
    unit,
    body,
    highlights,
    recommended,
    listPriceYen: priceYen,
    discountPercent: 0,
    campaignName: null,
    campaignEndsAt: null,
  };
}

/*
 * 札の中の短い約束。金額の正はこのファイル、文言の正もここ。
 * 「含まれるもの」の表と重複してよいが、ここでは買う前の判断だけを書く。
 */
export const SERVICE_PLANS: readonly ServicePlan[] = [
  planFrom(
    "free",
    "無料",
    `最初の${FREE_EVENT_LIMIT}回`,
    `イベントの公開を、累計${FREE_EVENT_LIMIT}回まで料金なしで試せます。`,
    0,
    ["チラシと告知ページの生成", "出欠の受付と集計", "参加者名簿と CSV"],
  ),
  planFrom(
    "single",
    "単発チケット",
    "1回",
    "必要なときだけ1回分を足します。たまに開く人向けです。",
    ONE_TIME_PRICE_JPY,
    [
      `無料の ${FREE_EVENT_LIMIT}回を使い切ったあとに`,
      "買った回数に期限なし",
      "領収書の発行も含む",
    ],
    true,
  ),
  planFrom(
    "subscription",
    "月額",
    "月",
    "契約が有効なあいだ、イベント作成の回数は数えません。",
    SUBSCRIPTION_PRICE_JPY,
    ["月に 4回以上開くなら、こちらが安い", "毎月の自動更新", "解約はいつでも。次の更新で止まる"],
  ),
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
