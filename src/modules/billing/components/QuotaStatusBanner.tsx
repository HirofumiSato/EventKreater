"use client";

import Link from "next/link";
import type { UserQuota } from "@/modules/events/types";
import { SUBSCRIPTION_PUBLISHED_EVENT_LIMIT } from "@/modules/billing/lib/plans";

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

function subscribedMessage(quota: UserQuota, periodLabel: string | null): string {
  const price = quota.subscriptionPlan === "MONTHLY_8" ? "980円" : "2,980円";
  // 日付入りの割引は、いつまで何円で使えるかが要るので残す。通常の自動更新は
  // 一覧の見出しでは繰り返さない（解約の条件は契約の画面が持つ）。
  // 初月無料も同じ位置・同じ 1 文で受け、無料期間の終わりだけを添える。
  const detail = periodLabel
    ? `${periodLabel}。終了後は月額${price}を自動で請求します（3日前と1日前にメールでお知らせ）。`
    : "";
  if (quota.subscriptionPlan === "MONTHLY_8") {
    const count = quota.publishedEventCount ?? 0;
    const limit = quota.publishedEventLimit ?? SUBSCRIPTION_PUBLISHED_EVENT_LIMIT;
    const remaining = Math.max(0, quota.remainingPublished ?? 0);
    // 残りは書かない。`N / 8` を読めば引けるうえ、件数が動くたびに文が伸び縮みする。
    // 件数の見出しは句点で終えないので、日付の 1 文は「。」でつないでから足す。
    const head =
      remaining === 0
        ? `公開中のイベントが${limit}件に達しました。終わったものは削除するか「公開一時停止」を使ってください`
        : `月額プランで公開中のイベント ${count} / ${limit} 件`;
    return detail ? `${head}。${detail}` : `${head}。`;
  }
  const count = quota.publishedEventCount ?? 0;
  return `公開し放題に加入中です。公開中のイベント ${count} 件（上限はありません）。${detail}`;
}

export function QuotaStatusBanner({ quota, onOpenPricing, nextPath = "/organizer/events" }: QuotaStatusBannerProps) {
  if (!quota) return null;
  const needsPhone = quota.planType === "FREE_TRIAL" && quota.phoneVerified === false;
  const isSubscribed = quota.subscriptionStatus === "ACTIVE";
  const discount = quota.discount;
  const discountLabel = discount
    ? `${discount.percent >= 100 ? "無料期間" : `${discount.percent}%割引`}（${dateLabel(discount.endsAt)} まで）`
    : null;
  const trial = quota.trial ?? null;
  const trialLabel = trial ? `初月無料（${dateLabel(trial.endsAt)} まで）` : null;
  // 初月無料と価格キャンペーンは併用しない。両方立つことはないが、先に初月無料を見る。
  const periodLabel = trialLabel ?? discountLabel;
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
        ? subscribedMessage(quota, periodLabel)
        : `${
            quota.publishedEventCount
              ? `公開中のイベント ${quota.publishedEventCount} 件。`
              : ""
          }無料トライアル残り ${quota.remainingFree}回${quota.paidCredits > 0 ? `（単発 ${quota.paidCredits}回）` : ""}${
            freeTicketAvailable ? ` ・ 0円チケット あと${quota.freeGrantRemaining}回` : ""
          }`;

  // 公開し放題は 402 が起きないので、プランを勧めるボタンを出さない。
  const showUpgradeButton = !isSubscribed || quota.subscriptionPlan === "MONTHLY_8";

  return (
    <div className={`alert ${tone} alert--compact`}>
      <p>
        {message}{" "}
        {needsPhone && (
          <Link href={`/auth/register?step=phone&next=${encodeURIComponent(nextPath)}`} className="btn btn--outline btn--sm">
            電話番号を確認する
          </Link>
        )}
        {isSubscribed && periodLabel && (
          <Link href="/terms" className="text-link">
            解約と自動更新の条件
          </Link>
        )}
      </p>
      {showUpgradeButton && (
        <button type="button" onClick={onOpenPricing} className="btn btn--primary btn--sm">
          {freeTicketAvailable ? "0円チケットを受け取る" : "公開し放題プランを見る"}
        </button>
      )}
    </div>
  );
}
