import type { PriceAudience } from "@prisma/client";

/**
 * 売上の集計だけを持つ純粋関数。
 * DB も Next.js も触らないので、API と画面の両方から同じ数字を引ける。
 *
 * 金額は「出席者が出欠を入れた時点のプラン金額」の写し（`Participant.priceAmount`）を使う。
 * `EventPricePlan.amount` を後から編集しても、過去の見込み売上は動かない。
 */

export interface RevenueParticipant {
  status: "ATTENDING" | "DECLINED";
  /** 出欠確定時点のプラン金額。null はプラン未選択、0 は無料プラン。 */
  priceAmount: number | null;
  pricePlanName: string | null;
  priceAudience: PriceAudience | null;
  scheduleId: string | null;
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
    if (row.status !== "ATTENDING") {
      declinedCount += 1;
      continue;
    }
    attendingCount += 1;
    if (row.priceAmount === null) {
      unassignedPlanCount += 1;
      continue;
    }
    paidAttendingCount += 1;
    expectedRevenue += row.priceAmount;
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
  subtotal: number;
}

/**
 * プラン別の内訳。金額が同じでもプラン名が違えば別行にする。
 * 名前も金額もスナップショットなので、同じ名前で金額が違う行が並ぶことがある
 * （出欠の途中でプラン金額を変えた場合）。その差は隠さずにそのまま見せる。
 */
export function groupByPlan(participants: readonly RevenueParticipant[]): PlanRevenueRow[] {
  const rows = new Map<string, PlanRevenueRow>();
  for (const row of participants) {
    if (row.status !== "ATTENDING" || row.priceAmount === null) continue;
    const name = row.pricePlanName ?? "プラン名なし";
    const audience = row.priceAudience ?? "ANY";
    const key = `${audience}\u0000${name}\u0000${row.priceAmount}`;
    const current = rows.get(key);
    if (current) {
      current.attendingCount += 1;
      current.subtotal += row.priceAmount;
      continue;
    }
    rows.set(key, {
      name,
      audience,
      amount: row.priceAmount,
      attendingCount: 1,
      subtotal: row.priceAmount,
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
  subtotal: number;
}

/** 開催回別の内訳。日時の並びは呼び出し側が `schedules` の順で決める。 */
export function groupBySchedule(participants: readonly RevenueParticipant[]): ScheduleRevenueRow[] {
  const rows = new Map<string | null, ScheduleRevenueRow>();
  for (const row of participants) {
    if (row.status !== "ATTENDING") continue;
    const key = row.scheduleId;
    const current = rows.get(key);
    if (current) {
      current.attendingCount += 1;
      current.subtotal += row.priceAmount ?? 0;
      continue;
    }
    rows.set(key, {
      scheduleId: key,
      attendingCount: 1,
      subtotal: row.priceAmount ?? 0,
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
  subtotal: number;
}
