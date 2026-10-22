/**
 * 共同主催の売上按分。DB も Next.js も触らない純粋関数だけを置く。
 *
 * 金額は円の整数。切り捨てだけを使い、余りは主催者（OWNER）へ寄せる。
 * 配分は「集金の分担を決める表示」であり、送金や入金の記録ではない。
 */

export type RevenueSplitMode = "RATIO" | "HEADCOUNT";
export type RevenueShareVisibility = "ALL" | "OWN_ONLY";
export type AllocationRole = "OWNER" | "CO_HOST";

/** 配分の分母。割合方式は 100.00% を basis points で持つ。 */
export const SHARE_BPS_TOTAL = 10000;

export interface AllocationOrganizer {
  organizerId: string;
  role: AllocationRole;
}

export interface AllocationShare {
  organizerId: string;
  shareBps: number | null;
  headcount: number | null;
}

export interface AllocationInput {
  mode: RevenueSplitMode;
  /** 作成順（createdAt 昇順）。並びは返り値でも保つ。 */
  organizers: readonly AllocationOrganizer[];
  shares: readonly AllocationShare[];
  expectedRevenue: number;
  issuedRevenue: number;
  /** 按分の分母になる出席者数。費用プラン未選択の人も数える。 */
  attendingCount: number;
}

export interface AllocationRow {
  organizerId: string;
  role: AllocationRole;
  /** 実際に使った割合。均等割へ落とした場合もここに入る。 */
  shareBps: number;
  /** 人数方式のときだけ入る。割合方式は null。 */
  headcount: number | null;
  expectedRevenue: number;
  issuedRevenue: number;
}

export interface AllocationAmounts {
  headcount: number;
  expectedRevenue: number;
  issuedRevenue: number;
}

export interface AllocationResult {
  mode: RevenueSplitMode;
  rows: AllocationRow[];
  /** 人数方式で配り切れなかった分。割合方式は常に 0。 */
  unallocated: AllocationAmounts;
}

function ownerIndex(organizers: readonly AllocationOrganizer[]): number {
  const index = organizers.findIndex((row) => row.role === "OWNER");
  return index >= 0 ? index : 0;
}

/**
 * 均等割の basis points。主催者以外を floor(10000 / N)、主催者に余りを寄せる。
 * 3人なら 33.33% / 33.33% / 33.34%。
 */
export function equalSharesBps(organizers: readonly AllocationOrganizer[]): number[] {
  const count = organizers.length;
  if (count === 0) return [];
  const base = Math.floor(SHARE_BPS_TOTAL / count);
  const remainder = SHARE_BPS_TOTAL - base * count;
  const owner = ownerIndex(organizers);
  return organizers.map((_, index) => (index === owner ? base + remainder : base));
}

function readShareMap(shares: readonly AllocationShare[]): Map<string, AllocationShare> {
  const map = new Map<string, AllocationShare>();
  for (const row of shares) map.set(row.organizerId, row);
  return map;
}

function readNonNegativeInt(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

/**
 * 割合方式で使う bps を決める。保存済みの設定が揃っていて合計 10000 のときだけ使い、
 * そうでなければ均等割にする（共同主催を後から足した直後でも表示が壊れない）。
 */
export function resolveSharesBps(
  organizers: readonly AllocationOrganizer[],
  shares: readonly AllocationShare[],
): number[] {
  const map = readShareMap(shares);
  const saved = organizers.map((row) => readNonNegativeInt(map.get(row.organizerId)?.shareBps));
  const complete = saved.every((value) => value !== null);
  const total = saved.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (complete && total === SHARE_BPS_TOTAL) return saved as number[];
  return equalSharesBps(organizers);
}

/**
 * 人数方式で使う人数を決める。未保存は 0 として扱う。
 * 出席者が減って合計が出席者数を超えた場合も、売上を超えないよう合計人数を分母にする。
 */
export function resolveHeadcounts(
  organizers: readonly AllocationOrganizer[],
  shares: readonly AllocationShare[],
): number[] {
  const map = readShareMap(shares);
  return organizers.map((row) => readNonNegativeInt(map.get(row.organizerId)?.headcount) ?? 0);
}

/**
 * 重みに応じて金額を配る。切り捨ての余りは主催者へ寄せる。
 * `denominator` が 0 のときは全員 0 円。
 *
 * `allocatedTotal` は配ってよい総額。人数方式で未割当があるときは
 * `floor(total * H / attending)` を渡し、余りと未割当を混同しないようにする。
 */
export function splitAmount(
  total: number,
  weights: readonly number[],
  denominator: number,
  owner: number,
  allocatedTotal: number = total,
): number[] {
  if (weights.length === 0) return [];
  if (total <= 0 || denominator <= 0) return weights.map(() => 0);
  const shares = weights.map((weight) => Math.floor((total * weight) / denominator));
  const remainder = allocatedTotal - shares.reduce((sum, value) => sum + value, 0);
  if (remainder > 0 && owner >= 0 && owner < shares.length) shares[owner] += remainder;
  return shares;
}

/** 按分の設定が保存されているか。表示の「未設定なら均等割」を出し分けるために使う。 */
export function isAllocationConfigured(
  mode: RevenueSplitMode,
  organizers: readonly AllocationOrganizer[],
  shares: readonly AllocationShare[],
): boolean {
  if (organizers.length === 0) return false;
  const map = readShareMap(shares);
  if (organizers.some((row) => !map.has(row.organizerId))) return false;
  if (mode === "RATIO") {
    const values = organizers.map((row) => readNonNegativeInt(map.get(row.organizerId)?.shareBps));
    return (
      values.every((value) => value !== null) &&
      values.reduce<number>((sum, value) => sum + (value ?? 0), 0) === SHARE_BPS_TOTAL
    );
  }
  return organizers.every(
    (row) => readNonNegativeInt(map.get(row.organizerId)?.headcount) !== null,
  );
}

/**
 * 見込み売上と領収書発行額を、同じ配分で按分する。
 * 端数は金額ごとに主催者へ寄せるので、それぞれの合計は元の金額と一致する。
 */
export function allocateRevenue(input: AllocationInput): AllocationResult {
  const { organizers, mode, expectedRevenue, issuedRevenue, attendingCount } = input;
  const owner = ownerIndex(organizers);

  if (mode === "RATIO") {
    const bps = resolveSharesBps(organizers, input.shares);
    const expected = splitAmount(expectedRevenue, bps, SHARE_BPS_TOTAL, owner);
    const issued = splitAmount(issuedRevenue, bps, SHARE_BPS_TOTAL, owner);
    return {
      mode,
      rows: organizers.map((row, index) => ({
        organizerId: row.organizerId,
        role: row.role,
        shareBps: bps[index] ?? 0,
        headcount: null,
        expectedRevenue: expected[index] ?? 0,
        issuedRevenue: issued[index] ?? 0,
      })),
      unallocated: { headcount: 0, expectedRevenue: 0, issuedRevenue: 0 },
    };
  }

  const headcounts = resolveHeadcounts(organizers, input.shares);
  const totalHeadcount = headcounts.reduce((sum, value) => sum + value, 0);
  const attending = Math.max(0, Math.floor(attendingCount));

  if (attending === 0) {
    return {
      mode,
      rows: organizers.map((row, index) => ({
        organizerId: row.organizerId,
        role: row.role,
        shareBps: 0,
        headcount: headcounts[index] ?? 0,
        expectedRevenue: 0,
        issuedRevenue: 0,
      })),
      unallocated: { headcount: 0, expectedRevenue: 0, issuedRevenue: 0 },
    };
  }

  // 保存済みの人数が出席者数を超えた場合（出席者が減った）は、売上を超えないよう
  // 合計人数を分母にする。未割当は出ない。
  const oversubscribed = totalHeadcount > attending;
  const denominator = oversubscribed ? totalHeadcount : attending;
  const allocatedExpected = oversubscribed
    ? expectedRevenue
    : Math.floor((expectedRevenue * totalHeadcount) / attending);
  const allocatedIssued = oversubscribed
    ? issuedRevenue
    : Math.floor((issuedRevenue * totalHeadcount) / attending);

  const expected = splitAmount(
    expectedRevenue,
    headcounts,
    denominator,
    owner,
    allocatedExpected,
  );
  const issued = splitAmount(issuedRevenue, headcounts, denominator, owner, allocatedIssued);

  return {
    mode,
    rows: organizers.map((row, index) => ({
      organizerId: row.organizerId,
      role: row.role,
      shareBps: 0,
      headcount: headcounts[index] ?? 0,
      expectedRevenue: expected[index] ?? 0,
      issuedRevenue: issued[index] ?? 0,
    })),
    unallocated: {
      headcount: oversubscribed ? 0 : Math.max(0, attending - totalHeadcount),
      expectedRevenue: Math.max(0, expectedRevenue - allocatedExpected),
      issuedRevenue: Math.max(0, issuedRevenue - allocatedIssued),
    },
  };
}

/** 画面用。basis points を小数第2位までの % 表記にする。 */
export function formatShareBps(bps: number): string {
  return (bps / 100).toFixed(2);
}

export type AllocationErrorCode =
  | "ORGANIZER_SET_MISMATCH"
  | "SHARE_TOTAL_NOT_100"
  | "HEADCOUNT_EXCEEDS_ATTENDING"
  | "INVALID_ALLOCATION_VALUE";

export interface AllocationValidationError {
  code: AllocationErrorCode;
  message: string;
  /** 409 のときだけ入る。画面で「12 / 18 人」と出すために使う。 */
  attendingCount?: number;
  totalHeadcount?: number;
}

export interface AllocationInputRow {
  organizerId: string;
  shareBps: number | null;
  headcount: number | null;
}

/**
 * 保存前の検証。`ORGANIZER_SET_MISMATCH` は主催者の過不足と他イベントの organizerId をまとめて扱う。
 */
export function validateAllocationRows(
  mode: RevenueSplitMode,
  organizers: readonly AllocationOrganizer[],
  rows: readonly AllocationInputRow[],
  attendingCount: number,
): AllocationValidationError | null {
  const expectedIds = new Set(organizers.map((row) => row.organizerId));
  const seen = new Set<string>();
  for (const row of rows) {
    if (!expectedIds.has(row.organizerId) || seen.has(row.organizerId)) {
      return {
        code: "ORGANIZER_SET_MISMATCH",
        message: "配分の対象が、このイベントの主催者と一致しません。",
      };
    }
    seen.add(row.organizerId);
  }
  if (seen.size !== expectedIds.size) {
    return {
      code: "ORGANIZER_SET_MISMATCH",
      message: "配分の対象が、このイベントの主催者と一致しません。",
    };
  }

  const values = rows.map((row) => (mode === "RATIO" ? row.shareBps : row.headcount));
  for (const value of values) {
    if (value === null || !Number.isInteger(value) || value < 0) {
      return {
        code: "INVALID_ALLOCATION_VALUE",
        message:
          mode === "RATIO"
            ? "割合は 0 以上 100 以下の数値（小数第2位まで）で入力してください。"
            : "人数は 0 以上の整数で入力してください。",
      };
    }
  }

  if (mode === "RATIO") {
    const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (total !== SHARE_BPS_TOTAL) {
      return {
        code: "SHARE_TOTAL_NOT_100",
        message: "割合の合計を 100.00% にしてください。",
      };
    }
    return null;
  }

  const totalHeadcount = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (totalHeadcount > attendingCount) {
    return {
      code: "HEADCOUNT_EXCEEDS_ATTENDING",
      message: `人数の合計が出席者数（${attendingCount} 人）を超えています。`,
      attendingCount,
      totalHeadcount,
    };
  }
  return null;
}
