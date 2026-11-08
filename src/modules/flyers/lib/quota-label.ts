import type { FlyerQuota } from "@/modules/flyers/types";

/**
 * 残り枚数の表示文言。
 *
 * 消費するのは AI の背景を作った瞬間なので、利用者にとって制限されているのは
 * 「背景を作る」ことだと読み取れる文にする。上限も必ず添える。
 * クライアントからも呼べるよう、prisma を触る `quota.ts` とは分けている。
 */
export function flyerQuotaLabel(
  quota: FlyerQuota,
  options?: { eventScoped?: boolean },
): string {
  const scope = quota.anonymous
    ? "未ログインで"
    : options?.eventScoped
      ? "このイベントで"
      : "";
  return `${scope}背景を作れるのは、残り ${quota.remaining} 枚（最大 ${quota.limit} 枚）`;
}
