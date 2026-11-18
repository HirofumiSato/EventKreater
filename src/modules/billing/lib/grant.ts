import type { SubscriptionPlan } from "@prisma/client";

/** 付与の判定に要る列だけを持つ。クォータ行でも、そこから写したオブジェクトでもよい。 */
export interface GrantedPlanFields {
  grantedPlan?: SubscriptionPlan | null;
}

/**
 * 運営付与の公開し放題か。
 *
 * Stripe の契約（`subscriptionStatus` / `subscriptionPlan`）とは別に見る。
 * 付与は支払い状況に左右されないので、`PAST_DUE` でもここが true なら公開できる。
 * `grantedPlan` は `UNLIMITED` だけを入れ、解除は NULL に戻す。
 *
 * Prisma を読まない純粋関数。クライアントの束からも呼べるよう、
 * `@prisma/client` は型だけを参照する（実行時には残らない）。
 */
export function hasUnlimitedGrant(quota: GrantedPlanFields | null | undefined): boolean {
  return quota?.grantedPlan === "UNLIMITED";
}
