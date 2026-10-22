import type { FlyerQuota } from "@/modules/flyers/types";

/**
 * 残り回数の表示文言。
 *
 * 消費するのは保存の瞬間だが、利用者にとって制限されているのは
 * 「チラシを作り直す・変更する」ことなので、そう読める文にする。
 * 上限も必ず添える。クライアントからも呼べるよう、prisma を触る
 * `quota.ts` とは分けている。
 */
export function flyerQuotaLabel(quota: FlyerQuota): string {
  const scope = quota.anonymous ? "未ログインで" : "この下書きで";
  return `${scope}チラシを作成・変更できるのは、残り ${quota.remaining} 回（最大 ${quota.limit} 回）`;
}
