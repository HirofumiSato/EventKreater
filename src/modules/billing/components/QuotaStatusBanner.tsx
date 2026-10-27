"use client";

import Link from "next/link";
import type { UserQuota } from "@/modules/events/types";

interface QuotaStatusBannerProps {
  quota: UserQuota | null;
  onOpenPricing: () => void;
  nextPath?: string;
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function subscribedMessage(quota: UserQuota, discountLabel: string | null): string {
  const price = quota.subscriptionPlan === "MONTHLY_8" ? "980円" : "2,980円";
  const detail = discountLabel
    ? `${discountLabel}。終了後は月額${price}を自動で請求します（終了の3日前と1日前にメールでお知らせします）。`
    : `毎月の自動更新です。解約するまで継続します。`;
  if (quota.subscriptionPlan === "MONTHLY_8") {
    const remaining = Math.max(0, quota.remainingMonthly ?? 0);
    const used = `今月は ${quota.monthlyEventCount ?? 0}/${quota.monthlyLimit ?? 8} 回`;
    const tail =
      remaining === 0
        ? "今月の上限に達しました。作り放題へ変更すると回数を気にせず作れます。"
        : `あと ${remaining}回つくれます。`;
    return `月8回プランに加入中です。${used}。${tail}${detail}`;
  }
  return `作り放題に加入中です。イベント作成の回数は数えません。${detail}`;
}

export function QuotaStatusBanner({ quota, onOpenPricing, nextPath = "/organizer/events" }: QuotaStatusBannerProps) {
  if (!quota) return null;
  const needsPhone = quota.planType === "FREE_TRIAL" && quota.phoneVerified === false;
  const isSubscribed = quota.subscriptionStatus === "ACTIVE";
  const discount = quota.discount;
  const discountLabel = discount
    ? `${discount.percent >= 100 ? "無料期間" : `${discount.percent}%割引`}（${dateLabel(discount.endsAt)} まで）`
    : null;
  const freeTicketAvailable = (quota.freeGrantRemaining ?? 0) > 0 && quota.pricing?.oneTime.chargedPrice === 0;

  const tone =
    quota.subscriptionStatus === "PAST_DUE" || !quota.canCreate || needsPhone
      ? "alert--warning"
      : isSubscribed
        ? "alert--info"
        : "alert--success";

  const message = needsPhone
    ? "無料枠を使うには電話番号の確認が必要です。"
    : quota.subscriptionStatus === "PAST_DUE"
      ? "お支払いに問題があります。カードを更新してください。"
      : isSubscribed
        ? subscribedMessage(quota, discountLabel)
        : `無料トライアル残り ${quota.remainingFree}回${quota.paidCredits > 0 ? `（単発クレジット ${quota.paidCredits}回）` : ""}${
            freeTicketAvailable ? ` ・ 0円チケットがあと${quota.freeGrantRemaining}回受け取れます` : ""
          }`;

  return (
    <div className={`alert ${tone}`} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
      <p>
        {message}{" "}
        {needsPhone && (
          <Link href={`/auth/register?step=phone&next=${encodeURIComponent(nextPath)}`} className="btn btn--outline btn--sm">
            電話番号を確認する
          </Link>
        )}
        {isSubscribed && discount && (
          <Link href="/terms" className="text-link">
            解約と自動更新の条件
          </Link>
        )}
      </p>
      {!isSubscribed && (
        <button type="button" onClick={onOpenPricing} className="btn btn--primary btn--sm">
          {freeTicketAvailable ? "0円チケットを受け取る" : "使い放題プランを見る"}
        </button>
      )}
    </div>
  );
}
