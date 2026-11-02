import { prisma } from "@/lib/prisma";
import { FIRST_MONTH_FREE_MONTHS } from "@/modules/billing/lib/plans";
import { addMonthsUtc } from "@/modules/billing/lib/pricing";

/**
 * 月額プランの初月無料（Stripe のネイティブトライアル）の判定だけを持つ。
 *
 * 初月無料は「はじめての月額加入」に1回だけ付く。判定と終了日の計算は純粋関数にして、
 * Stripe も DB も要らない形で試験できるようにする。DB を読むのは `resolveTrial` だけ。
 */

/** 加入から何か月を無料にするか。`plans.ts` の定数と同じ値を使う。 */
export const TRIAL_MONTHS = FIRST_MONTH_FREE_MONTHS;

/**
 * 無料期間の終了日時。加入した時刻から1か月後を、既存の請求計算と同じ数え方で出す。
 * 月末をまたぐ日付（1月31日 → 2月28日）もうるう年も `addMonthsUtc` に合わせる。
 */
export function trialEndsAt(start: Date): Date {
  return addMonthsUtc(start, TRIAL_MONTHS);
}

export interface TrialEligibilityInput {
  /** 初月無料を使った日時。1度でも使っていれば再適用しない。 */
  trialUsedAt: Date | null;
  /** いま契約中のサブスクリプション。解約済みでも、再加入では初月無料にしない。 */
  stripeSubscriptionId: string | null;
  /**
   * これまでに決済が済んだ月額の件数。`PENDING` は放棄した Checkout が残るので数えない。
   */
  priorSubscriptions: number;
}

/**
 * 初月無料を使えるか。3つとも空のときだけ使える。
 * 解約して再加入しても、別のプランへ変えても再適用しない。
 */
export function isTrialEligible(input: TrialEligibilityInput): boolean {
  return (
    input.trialUsedAt === null &&
    input.stripeSubscriptionId === null &&
    input.priorSubscriptions === 0
  );
}

/** 初月無料を使えるなら、その終了日時を持つ。使えないときは `endsAt` が null。 */
export type ResolvedTrial =
  | { eligible: true; endsAt: Date }
  | { eligible: false; endsAt: null };

/**
 * この人がいま初月無料を使えるかと、使うときの終了日時（加入時刻の1か月後）を返す。
 *
 * チケット情報が無い会員は、決済の入口で別の 404 になるので、ここでは資格なしとして返す。
 * `now` は加入時刻として使う。画面の表示だけなら既定の現在時刻でよい。
 */
export async function resolveTrial(
  userId: string,
  now: Date = new Date(),
): Promise<ResolvedTrial> {
  const [quota, priorSubscriptions] = await Promise.all([
    prisma.userUsageQuota.findUnique({
      where: { userId },
      select: { trialUsedAt: true, stripeSubscriptionId: true },
    }),
    prisma.billingTransaction.count({
      where: {
        userId,
        paymentType: "SUBSCRIPTION",
        paymentStatus: "SUCCEEDED",
      },
    }),
  ]);

  if (!quota) return { eligible: false, endsAt: null };

  const eligible = isTrialEligible({
    trialUsedAt: quota.trialUsedAt,
    stripeSubscriptionId: quota.stripeSubscriptionId,
    priorSubscriptions,
  });
  return eligible
    ? { eligible: true, endsAt: trialEndsAt(now) }
    : { eligible: false, endsAt: null };
}
