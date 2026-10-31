"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ONE_TIME_PRICE_JPY,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
} from "@/modules/billing/lib/plans";
import type { PricingQuote } from "@/modules/events/types";
import { yenMark } from "@/lib/format";
import { Alert, Dialog } from "@/components/ui";

/** 申し込む定額プラン。DB の SubscriptionPlan から NONE を除いた形。 */
export type SubscriptionChoice = "MONTHLY_8" | "UNLIMITED";

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOneTime: () => Promise<unknown>;
  onSelectSubscription: (plan: SubscriptionChoice) => Promise<unknown>;
  /** いまの販売価格。無いときは定価で表示する。 */
  quotes?: {
    oneTime: PricingQuote;
    subscription8: PricingQuote;
    subscriptionUnlimited: PricingQuote;
  } | null;
  freeGrantRemaining?: number;
  onGranted?: () => void;
  /** 加入中の定額プラン。「現在のプラン」を出して、同じ札を押せなくする。 */
  currentPlan?: "NONE" | "MONTHLY_8" | "UNLIMITED";
  /** 開いた画面。キャンセル時の文言を合わせる。 */
  context?: "create" | "edit" | "preview" | "list" | "mypage";
}

const CANCEL_LABEL: Record<NonNullable<PricingModalProps["context"]>, string> = {
  create: "作成に戻る",
  edit: "編集に戻る",
  preview: "プレビューに戻る",
  list: "閉じる",
  mypage: "閉じる",
};

function endsAtLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function PriceBlock({ quote, fallback }: { quote: PricingQuote | null; fallback: number }) {
  const charged = quote?.chargedPrice ?? fallback;
  const list = quote?.listPrice ?? fallback;
  const discounted = charged < list;
  const deadline = endsAtLabel(quote?.campaignEndsAt ?? null);

  return (
    <div>
      {discounted && (
        <p className="eyebrow" style={{ color: "var(--color-primary-text)" }}>
          {quote?.discountKind === "FREE" ? "全額無料" : `${quote?.discountPercent}%OFF`}
          {quote?.campaignName ? ` ・ ${quote.campaignName}` : ""}
        </p>
      )}
      <p className="stat__value">
        {yenMark(charged)}
        {discounted && (
          <span
            style={{
              marginLeft: "0.5rem",
              fontSize: "0.875rem",
              color: "var(--color-text-faint)",
              textDecoration: "line-through",
            }}
          >
            {yenMark(list)}
          </span>
        )}
      </p>
      {charged > 0 && <p className="help">（税込）</p>}
      {discounted && deadline && (
        <p className="help">
          {quote?.campaignEndsAt ? `${endsAtLabel(quote.campaignEndsAt)} まで` : ""}
          {quote && quote.target !== "ONE_TIME" ? "（加入から割引月数ぶん適用）" : ""}
        </p>
      )}
    </div>
  );
}

export function PricingModal({
  isOpen,
  onClose,
  onSelectOneTime,
  onSelectSubscription,
  quotes,
  freeGrantRemaining,
  currentPlan = "NONE",
  onGranted,
  context = "list",
}: PricingModalProps) {
  const [loadingPlan, setLoadingPlan] = useState<"SINGLE" | SubscriptionChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const oneTime = quotes?.oneTime ?? null;
  const subscription8 = quotes?.subscription8 ?? null;
  const subscriptionUnlimited = quotes?.subscriptionUnlimited ?? null;
  const isFree = oneTime?.chargedPrice === 0;
  const freeExhausted = isFree && freeGrantRemaining === 0;

  const handleOneTime = async () => {
    setLoadingPlan("SINGLE");
    setError(null);
    try {
      const result = await onSelectOneTime();
      if (result === "GRANTED") {
        onGranted?.();
        onClose();
        return;
      }
      if (result === "LIMITED") {
        setError("このキャンペーンでの受け取りは上限に達しています。単発チケットか月額プランをご利用ください。");
      } else if (result === "PHONE_REQUIRED") {
        setError("0円で受け取るには電話番号の確認が必要です。");
      }
      setLoadingPlan(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "単発購入セッション作成に失敗しました");
      setLoadingPlan(null);
    }
  };

  const handleSubscription = async (plan: SubscriptionChoice) => {
    setLoadingPlan(plan);
    setError(null);
    try {
      await onSelectSubscription(plan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "サブスクリプションセッション作成に失敗しました");
      setLoadingPlan(null);
    }
  };

  return (
    <Dialog
      title="プランを選ぶ"
      onClose={onClose}
      actions={<><button type="button" onClick={onClose} disabled={loadingPlan !== null} className="btn btn--ghost btn--block">
            {CANCEL_LABEL[context]}
          </button></>}
    >
      <p className="dialog__body">続けるには、どれかを選んでください。</p>
        <div className="stack" style={{ marginTop: "1.25rem" }}>
          <article className="card">
            <h4 className="card__title">単発チケット</h4>
            <PriceBlock quote={oneTime} fallback={ONE_TIME_PRICE_JPY} />
            <p className="card__body">
              1回分。スポット開催に。
              {isFree && ` おひとり${oneTime?.freePerUserLimit ?? 1}回まで無料です。`}
            </p>
            <button
              type="button"
              onClick={() => void handleOneTime()}
              disabled={loadingPlan !== null || freeExhausted}
              className="btn btn--block"
            >
              {loadingPlan === "SINGLE"
                ? "処理しています…"
                : freeExhausted
                  ? "受け取り済みです"
                  : isFree
                    ? "無料で受け取る"
                    : "単発で購入する"}
            </button>
          </article>
          <article className="card">
            <p className="eyebrow">公開中のイベントを同時に{SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件まで</p>
            <h4 className="card__title">月額で{SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件まで公開プラン</h4>
            <PriceBlock quote={subscription8} fallback={SUBSCRIPTION_8_PRICE_JPY} />
            <p className="card__body">
              公開中は{SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件まで。終了したものと停止中は数えません。
              {subscription8?.chargedPrice === 0
                ? " 無料期間の終了後は、登録したカードへ自動で請求します。"
                : ""}
            </p>
            <button
              type="button"
              onClick={() => void handleSubscription("MONTHLY_8")}
              disabled={loadingPlan !== null || currentPlan === "MONTHLY_8"}
              className="btn btn--block"
            >
              {currentPlan === "MONTHLY_8"
                ? "現在のプラン"
                : loadingPlan === "MONTHLY_8"
                  ? "接続しています…"
                  : subscription8?.chargedPrice === 0
                    ? "0円で定期購入を始める"
                    : "このプランを始める"}
            </button>
          </article>
          <article className="card" style={{ borderTop: "3px solid var(--color-primary)" }}>
            <p className="eyebrow">公開中の件数を数えない</p>
            <h4 className="card__title">公開し放題</h4>
            <PriceBlock quote={subscriptionUnlimited} fallback={SUBSCRIPTION_UNLIMITED_PRICE_JPY} />
            <p className="card__body">
              公開中の件数を数えません。教室や常設のイベント向けです。
              {subscriptionUnlimited?.chargedPrice === 0
                ? " 無料期間の終了後は、登録したカードへ自動で請求します。"
                : ""}
            </p>
            <button
              type="button"
              onClick={() => void handleSubscription("UNLIMITED")}
              disabled={loadingPlan !== null || currentPlan === "UNLIMITED"}
              className="btn btn--primary btn--block"
            >
              {currentPlan === "UNLIMITED"
                ? "現在のプラン"
                : loadingPlan === "UNLIMITED"
                  ? "接続しています…"
                  : subscriptionUnlimited?.chargedPrice === 0
                    ? "0円で定期購入を始める"
                    : "定期購入で公開し放題"}
            </button>
          </article>
        </div>
        {error && <Alert tone="error" style={{ marginTop: "1rem" }}>{error}</Alert>}
        <p className="help" style={{ marginTop: "1rem" }}>
          無料期間が終わると自動で有料になります。3日前と1日前にメールでお知らせします。詳しくは
          <Link href="/terms" className="text-link">
            利用規約
          </Link>
          をご確認ください。
        </p>
    </Dialog>
  );
}
