import type { UserQuota } from "@/modules/events/types";

/** 公開の直前に出す確認。何を1枚使うかと、使う前後の残りを持つ。 */
export interface PublishConfirmation {
  kind: "FREE_TICKET" | "PAID_CREDIT" | "FREE_TRIAL";
  remaining: number;
  remainingAfter: number;
}

/**
 * 種類ごとの「いまの残り」をクォータから読む。
 *
 * 公開後に最新のクォータを取り直したときの表示に使う。取り直せなかったときは、
 * 確認のときに持っていた `PublishConfirmation.remainingAfter` を代わりに使う。
 * クォータが分からないときは 0 を返す。
 */
export function remainingFor(
  quota: UserQuota | null,
  kind: PublishConfirmation["kind"],
): number {
  if (!quota) return 0;
  switch (kind) {
    case "FREE_TICKET":
      return quota.tickets?.available ?? 0;
    case "PAID_CREDIT":
      return quota.paidCredits;
    case "FREE_TRIAL":
      return quota.remainingFree;
  }
}

/**
 * 定額が有効かどうか。
 *
 * `src/modules/billing/lib/quota.ts` の `isSubscriptionActive` と同じ条件だが、
 * あちらは Prisma を import しているため、そのまま読むとクライアントの束へ
 * Prisma を引き込んでしまう。ここでは import せず、条件だけを写している。
 * 条件を変えるときは両方をそろえること。
 */
function subscriptionActive(quota: UserQuota, now: Date): boolean {
  return (
    quota.subscriptionStatus === "ACTIVE" &&
    quota.currentPeriodEnd !== null &&
    new Date(quota.currentPeriodEnd) > now
  );
}

function confirmationOf(
  kind: PublishConfirmation["kind"],
  remaining: number,
): PublishConfirmation {
  return { kind, remaining, remainingAfter: Math.max(0, remaining - 1) };
}

/**
 * 「公開する」を押したときに、消費するチケットの確認を出すかどうかを決める。
 *
 * 分岐の順は `consumeEventQuota` と同じ。定額が有効な間は消費しないので null だが、
 * 月額で8件まで公開プランが上限に達したときだけは、サーバーがチケット・単発へ
 * 落とすので同じように落とす。チケット → 単発チケット → 無料チケットの順で、
 * どれも残っていなければ null（確認を出さず、そのまま公開か 402 の料金案内へ進む）。
 * クォータが分からないときも null。
 */
export function publishConfirmation(
  quota: UserQuota | null,
  now = new Date(),
): PublishConfirmation | null {
  if (!quota) return null;

  // 支払いに問題があるあいだはサーバーが 402 で止める。確認を出して料金案内へ飛ばすのは矛盾する。
  if (quota.subscriptionStatus === "PAST_DUE") return null;

  const active = subscriptionActive(quota, now);

  if (active) {
    // 公開し放題は件数を数えない。公開しても何も消費しない。
    if (quota.subscriptionPlan !== "MONTHLY_8") return null;

    // 上限未満ならプランの件数に収まる。上限に達したときは下へ落とし、
    // 黙ってチケットを1枚使われるのを防ぐ。
    if ((quota.remainingPublished ?? 0) > 0) return null;
  }

  const tickets = quota.tickets?.available ?? 0;
  if (tickets >= 1) return confirmationOf("FREE_TICKET", tickets);
  if (quota.paidCredits >= 1) return confirmationOf("PAID_CREDIT", quota.paidCredits);

  // 無料チケットは加入前のためのもの。加入中は上限に達しても使えないので判定しない。
  // 電話番号が未確認ならサーバーは 403 で確認へ送るので出さない（不明は従来どおり出す）。
  if (!active && quota.remainingFree >= 1 && quota.phoneVerified !== false) {
    return confirmationOf("FREE_TRIAL", quota.remainingFree);
  }

  return null;
}
