import type { SubscriptionPlan } from "@prisma/client";

/** 付与の種別。`granted_plan` が何を付与したかを持つのに対し、こちらはなぜ付与したかを持つ。 */
export type GrantKind = "OPERATOR" | "DEMO";

/** 付与の判定に要る列だけを持つ。クォータ行でも、そこから写したオブジェクトでもよい。 */
export interface GrantedPlanFields {
  grantedPlan?: SubscriptionPlan | null;
}

/** 付与の種別に要る列だけを持つ。種別が無い行（列を足す前の付与）は OPERATOR として扱う。 */
export interface GrantedKindFields {
  grantedKind?: GrantKind | null;
}

/**
 * 運営付与の公開し放題か。
 *
 * Stripe の契約（`subscriptionStatus` / `subscriptionPlan`）とは別に見る。
 * 付与は支払い状況に左右されないので、`PAST_DUE` でもここが true なら公開できる。
 * `grantedPlan` は `UNLIMITED` だけを入れ、解除は NULL に戻す。
 *
 * デモ付与も `granted_plan = 'UNLIMITED'` なので、ここは真になる。種別で分けるのは
 * 表示（帯・プラン画面）と管理画面の操作だけで、公開可否の判定はこの 1 本のまま。
 *
 * Prisma を読まない純粋関数。クライアントの束からも呼べるよう、
 * `@prisma/client` は型だけを参照する（実行時には残らない）。
 */
export function hasUnlimitedGrant(quota: GrantedPlanFields | null | undefined): boolean {
  return quota?.grantedPlan === "UNLIMITED";
}

/**
 * 付与の種別。DEMO だけをデモ付与とし、それ以外（NULL・未定義を含む）は運営付与として扱う。
 *
 * 種別の列を足す前の付与は NULL なので、`OPERATOR` に寄せる。付与が無い行でも
 * 例外を投げず `OPERATOR` を返す（呼ぶ側は `hasUnlimitedGrant` と組みで見る）。
 */
export function grantKindOf(quota: GrantedKindFields | null | undefined): GrantKind {
  return quota?.grantedKind === "DEMO" ? "DEMO" : "OPERATOR";
}

/** 営業デモとして付与された公開し放題か。 */
export function isDemoGrant(quota: GrantedKindFields | null | undefined): boolean {
  return grantKindOf(quota) === "DEMO";
}
