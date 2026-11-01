import type { PriceAudience } from "@prisma/client";
import type { RsvpStatus } from "@/modules/events/types";

/**
 * 売上の集計だけを持つ純粋関数。
 * DB も Next.js も触らないので、API と画面の両方から同じ数字を引ける。
 *
 * 金額は「出席者が出欠を入れた時点のプラン金額」の写し（`Participant.priceAmount`）を使う。
 * `EventPricePlan.amount` を後から編集しても、過去の見込み売上は動かない。
 */

export interface RevenueParticipant {
  status: RsvpStatus;
  /** 出欠確定時点のプラン金額。null はプラン未選択、0 は無料プラン。 */
  priceAmount: number | null;
  pricePlanName: string | null;
  priceAudience: PriceAudience | null;
  scheduleId: string | null;
  /** 自分を含む参加人数。省略した呼び出し（テストなど）は 1 人として扱う。 */
  partySize?: number;
  /**
   * 申込時に選んだ割引の写し。省略した呼び出し（テストなど）は割引なしとして扱う。
   * 合計額をプラン金額から引き、支払額は 0 円で止める。
   */
  discounts?: readonly { amount: number }[];
}

/** 人数。0 以下や小数は 1 人に寄せ、売上と定員が負にならないようにする。 */
export function partySizeOf(row: { partySize?: number }): number {
  const size = row.partySize ?? 1;
  if (!Number.isFinite(size) || size < 1) return 1;
  return Math.floor(size);
}

/** 割引の合計額。負の値は数えない（0 円未満の値引きは定義できない）。 */
export function discountTotal(rows: readonly { amount: number }[] | undefined): number {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((total, row) => total + Math.max(0, row.amount), 0);
}

/**
 * 1 人ぶんの支払額。割引は引くが、人数は掛けない。0 円未満にはしない。
 * 領収書は 1 人ずつ切るので、発行画面の既定額はこの値を使う。
 * 合計を人数で割るのではなく元の金額から引き直し、割り切れない端数を出さない。
 */
export function unitPayableAmount(row: {
  priceAmount: number | null;
  discounts?: readonly { amount: number }[];
}): number | null {
  if (row.priceAmount === null) return null;
  return Math.max(0, row.priceAmount - discountTotal(row.discounts));
}

/**
 * 割引を引いた支払額。0 円未満にはしない。
 * 金額は 1 人ぶんなので、自分を含む人数を掛ける（3 人で 3,000 円なら 9,000 円）。
 * プラン未選択（null）は null のまま返し、売上の分母に入れない。
 */
export function payableAmount(row: {
  priceAmount: number | null;
  discounts?: readonly { amount: number }[];
  partySize?: number;
}): number | null {
  const perPerson = unitPayableAmount(row);
  if (perPerson === null) return null;
  return perPerson * partySizeOf(row);
}

export interface RevenueSummary {
  /** 見込み売上。出席かつプラン選択済みの金額の合計。 */
  expectedRevenue: number;
  /** 領収書を発行した金額の合計。決済や入金の記録ではない。 */
  issuedRevenue: number;
  /** 見込みと発行済みの差。未回収ではなく「要確認」として出す。 */
  unreconciled: number;
  attendingCount: number;
  /** 金額の分かる出席者。平均単価の分母。 */
  paidAttendingCount: number;
  /** 出席しているがプラン未選択。売上には加算しない。 */
  unassignedPlanCount: number;
  declinedCount: number;
  receiptCount: number;
  /** 出席1人あたりの見込み売上。0 人のときは 0。 */
  averagePerAttendee: number;
}

export function averageRevenue(expectedRevenue: number, paidAttendingCount: number): number {
  if (paidAttendingCount <= 0) return 0;
  return Math.round(expectedRevenue / paidAttendingCount);
}

export function summarizeRevenue(
  participants: readonly RevenueParticipant[],
  receipts: readonly { amount: number }[] = [],
): RevenueSummary {
  let expectedRevenue = 0;
  let attendingCount = 0;
  let paidAttendingCount = 0;
  let unassignedPlanCount = 0;
  let declinedCount = 0;

  for (const row of participants) {
    // 参加要望はまだ席を持っていない。売上にも欠席数にも入れない。
    if (row.status === "WAITLISTED") continue;
    if (row.status !== "ATTENDING") {
      declinedCount += 1;
      continue;
    }
    const size = partySizeOf(row);
    attendingCount += size;
    if (row.priceAmount === null) {
      unassignedPlanCount += size;
      continue;
    }
    paidAttendingCount += size;
    expectedRevenue += payableAmount(row) ?? 0;
  }

  const issuedRevenue = receipts.reduce((total, receipt) => total + receipt.amount, 0);

  return {
    expectedRevenue,
    issuedRevenue,
    unreconciled: expectedRevenue - issuedRevenue,
    attendingCount,
    paidAttendingCount,
    unassignedPlanCount,
    declinedCount,
    receiptCount: receipts.length,
    averagePerAttendee: averageRevenue(expectedRevenue, paidAttendingCount),
  };
}

export interface PlanRevenueRow {
  name: string;
  audience: PriceAudience;
  /** 出欠確定時点の金額。同じプランでも編集をまたぐと別の行になる。 */
  amount: number;
  attendingCount: number;
  /** 割引の合計額。支払額 = 見込み売上（この行の小計） + 割引の小計。 */
  discountSubtotal: number;
  /** 割引を引いた小計。 */
  subtotal: number;
}

/**
 * プラン別の内訳。金額が同じでもプラン名や割引額が違えば別行にする。
 * 名前・金額・割引はスナップショットなので、同じ名前で金額が違う行が並ぶことがある
 * （出欠の途中でプラン金額や割引を変えた場合）。その差は隠さずにそのまま見せる。
 */
export function groupByPlan(participants: readonly RevenueParticipant[]): PlanRevenueRow[] {
  const rows = new Map<string, PlanRevenueRow>();
  for (const row of participants) {
    if (row.status !== "ATTENDING" || row.priceAmount === null) continue;
    const name = row.pricePlanName ?? "プラン名なし";
    const audience = row.priceAudience ?? "ANY";
    const size = partySizeOf(row);
    const discount = discountTotal(row.discounts) * size;
    const key = `${audience}\u0000${name}\u0000${row.priceAmount}\u0000${discountTotal(row.discounts)}`;
    const current = rows.get(key);
    if (current) {
      current.attendingCount += size;
      current.discountSubtotal += discount;
      current.subtotal += payableAmount(row) ?? 0;
      continue;
    }
    rows.set(key, {
      name,
      audience,
      amount: row.priceAmount,
      attendingCount: size,
      discountSubtotal: discount,
      subtotal: payableAmount(row) ?? 0,
    });
  }
  return [...rows.values()].sort((a, b) => {
    if (a.audience !== b.audience) return a.audience.localeCompare(b.audience);
    if (b.subtotal !== a.subtotal) return b.subtotal - a.subtotal;
    return a.name.localeCompare(b.name, "ja");
  });
}

export interface ScheduleRevenueRow {
  /** 開催日時が消えた参加者（SetNull）は null。 */
  scheduleId: string | null;
  attendingCount: number;
  /** 割引の合計額。 */
  discountSubtotal: number;
  /** 割引を引いた小計。 */
  subtotal: number;
}

/** 開催回別の内訳。日時の並びは呼び出し側が `schedules` の順で決める。 */
export function groupBySchedule(participants: readonly RevenueParticipant[]): ScheduleRevenueRow[] {
  const rows = new Map<string | null, ScheduleRevenueRow>();
  for (const row of participants) {
    if (row.status !== "ATTENDING") continue;
    const key = row.scheduleId;
    const size = partySizeOf(row);
    const discount = discountTotal(row.discounts) * size;
    const current = rows.get(key);
    if (current) {
      current.attendingCount += size;
      current.discountSubtotal += discount;
      current.subtotal += payableAmount(row) ?? 0;
      continue;
    }
    rows.set(key, {
      scheduleId: key,
      attendingCount: size,
      discountSubtotal: discount,
      subtotal: payableAmount(row) ?? 0,
    });
  }
  return [...rows.values()];
}

/** 一覧のイベント行に出す、イベント1件ぶんの集計。 */
export interface EventRevenueRow extends RevenueSummary {
  id: string;
  title: string;
  /** YYYY-MM-DD。 */
  sortDate: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  /** 自分が筆頭幹事か共同主催者か。 */
  role: "OWNER" | "CO_HOST";
  /** 按分後の自分の見込み取り分。主催者が1人のイベントは全額。 */
  myShare: { expectedRevenue: number };
}

/** 開催回別の内訳。表示用のラベルはサーバーで合成する。 */
export interface ScheduleRevenueView {
  scheduleId: string | null;
  label: string;
  attendingCount: number;
  /** 割引の合計額。 */
  discountSubtotal: number;
  /** 割引を引いた小計。 */
  subtotal: number;
}
