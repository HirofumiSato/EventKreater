import type { FlyerQuota } from "@/modules/flyers/types";

/**
 * 残り回数の表示文言。
 *
 * 数字だけでは「何が」残っているのか伝わらないため、チラシを保存できる
 * 回数（＝作り直せる回数）であることと、上限を必ず添える。
 * クライアントからも呼べるよう、prisma を触る `quota.ts` とは分けている。
 */
export function flyerQuotaLabel(quota: FlyerQuota): string {
  const scope = quota.anonymous ? "未ログインで" : "この下書きで";
  return `${scope}チラシを保存できるのは、残り ${quota.remaining} 回（最大 ${quota.limit} 回）`;
}
