"use client";

import Link from "next/link";
import { useState } from "react";
import {
  FIRST_MONTH_FREE_LABEL,
  ONE_TIME_PRICE_JPY,
  SUBSCRIPTION_8_PRICE_JPY,
  SUBSCRIPTION_PUBLISHED_EVENT_LIMIT,
  SUBSCRIPTION_UNLIMITED_PRICE_JPY,
} from "@/modules/billing/lib/plans";
import type { PricingQuote, UserQuota } from "@/modules/events/types";
import { yen, yenMark } from "@/lib/format";
import { Alert, Dialog } from "@/components/ui";

/** 申し込む定額プラン。DB の SubscriptionPlan から NONE を除いた形。 */
export type SubscriptionChoice = "MONTHLY_8" | "UNLIMITED";

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOneTime: () => Promise<unknown>;
  onSelectSubscription: (plan: SubscriptionChoice) => Promise<unknown>;
  /**
   * チケットと販売価格。価格・残り・加入中のプランを 1 つにまとめて受ける。
   * 項目を足すたびに5画面の呼び出しを直さないため、個別の props は持たない。
   */
  quota?: UserQuota | null;
  onGranted?: () => void;
  /**
   * 「チケットで公開する」を押したとき。閉じてから呼び出し元が公開をやり直す。
   * 渡さない画面（一覧・マイページ）では、閉じるだけにする。
   */
  onUseTicket?: () => void;
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

/**
 * 初月無料の価格段。キャンペーン用の `PriceBlock` とは別に、
 * 「0円 / 初月」と「2か月目から」の 2 段で組む。初月無料があるときは
 * キャンペーン価格よりこちらを優先する（併用しない規則）。
 */
function TrialPriceBlock({ listPrice }: { listPrice: number }) {
  return (
    <div>
      <p className="eyebrow" style={{ color: "var(--color-primary-text)" }}>
        {FIRST_MONTH_FREE_LABEL}
      </p>
      <p className="stat__value">
        0
        <span style={{ marginLeft: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
          円 / 初月
        </span>
      </p>
      <p className="help">2か月目から {yen(listPrice)}（税込）</p>
    </div>
  );
}

export function PricingModal({
  isOpen,
  onClose,
  onSelectOneTime,
  onSelectSubscription,
  quota,
  onGranted,
  onUseTicket,
  context = "list",
}: PricingModalProps) {
  const [loadingPlan, setLoadingPlan] = useState<"SINGLE" | SubscriptionChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const quotes = quota?.pricing ?? null;
  const oneTime = quotes?.oneTime ?? null;
  const subscription8 = quotes?.subscription8 ?? null;
  const subscriptionUnlimited = quotes?.subscriptionUnlimited ?? null;
  const isFree = oneTime?.chargedPrice === 0;
  const freeExhausted = isFree && (quota?.freeGrantRemaining ?? 0) === 0;
  const currentPlan = quota?.subscriptionPlan ?? "NONE";
  const trialEligible = quota?.trialEligible ?? false;
  // 期限つきのチケットを持っているなら、それが一番安く早い。0円キャンペーン中は
  // そちらで1枚を受け取れるので、チケットの札は出さない（選ぶものが2つになる）。
  // 押したあとに公開をやり直せない画面（作成中・マイページ）では、使えない札を出さない。
  const ticketAvailable = isFree ? 0 : (quota?.tickets?.available ?? 0);
  const hasTicket = ticketAvailable > 0 && Boolean(onUseTicket);
  const ticketExpiringAt = endsAtLabel(quota?.tickets?.expiringAt ?? null);

  const handleUseTicket = () => {
    onClose();
    onUseTicket?.();
  };

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
          {/* チケットは買わずに使えるもの。札の並びの先頭に置き、主操作もここへ移す。 */}
          {hasTicket && (
            <article className="card ticket-card">
              <h4 className="card__title">チケットで公開する</h4>
              <p className="card__body">
                残り{ticketAvailable}枚。{ticketExpiringAt ? `${ticketExpiringAt} まで有効。` : ""}
                紹介した人が公開すると2枚もらえます。
              </p>
              <button
                type="button"
                onClick={handleUseTicket}
                disabled={loadingPlan !== null}
                className="btn btn--primary btn--block"
              >
                チケットで公開する
              </button>
            </article>
          )}
          <article className="card">
            <h4 className="card__title">単発チケット</h4>
            <PriceBlock quote={oneTime} fallback={ONE_TIME_PRICE_JPY} />
            <p className="card__body">
              1枚。スポット開催に。
              {isFree && ` おひとり${oneTime?.freePerUserLimit ?? 1}枚まで無料です。`}
            </p>
            <button
              type="button"
              onClick={() => void handleOneTime()}
              disabled={loadingPlan !== null || freeExhausted}
              className={`btn btn--block${hasTicket ? " btn--outline" : ""}`}
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
            {/* 初月無料のときは、価格段の見出し（初月0円）に場所を譲る。 */}
            {!trialEligible && (
              <p className="eyebrow">公開中のイベントを同時に{SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件まで</p>
            )}
            <h4 className="card__title">{SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件まで公開プラン</h4>
            {trialEligible ? (
              <TrialPriceBlock listPrice={subscription8?.listPrice ?? SUBSCRIPTION_8_PRICE_JPY} />
            ) : (
              <PriceBlock quote={subscription8} fallback={SUBSCRIPTION_8_PRICE_JPY} />
            )}
            <p className="card__body">
              公開中は{SUBSCRIPTION_PUBLISHED_EVENT_LIMIT}件まで。終了したものと停止中は数えません。
              {!trialEligible && subscription8?.chargedPrice === 0
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
                  : trialEligible
                    ? "初月0円で始める"
                    : subscription8?.chargedPrice === 0
                      ? "0円で定期購入を始める"
                      : "このプランを始める"}
            </button>
          </article>
          <article className="card" style={{ borderTop: "3px solid var(--color-primary)" }}>
            {!trialEligible && <p className="eyebrow">公開中の件数を数えない</p>}
            <h4 className="card__title">公開し放題プラン</h4>
            {trialEligible ? (
              <TrialPriceBlock listPrice={subscriptionUnlimited?.listPrice ?? SUBSCRIPTION_UNLIMITED_PRICE_JPY} />
            ) : (
              <PriceBlock quote={subscriptionUnlimited} fallback={SUBSCRIPTION_UNLIMITED_PRICE_JPY} />
            )}
            <p className="card__body">
              公開中の件数を数えません。教室や常設のイベント向けです。
              {!trialEligible && subscriptionUnlimited?.chargedPrice === 0
                ? " 無料期間の終了後は、登録したカードへ自動で請求します。"
                : ""}
            </p>
            <button
              type="button"
              onClick={() => void handleSubscription("UNLIMITED")}
              disabled={loadingPlan !== null || currentPlan === "UNLIMITED"}
              className={`btn btn--block${hasTicket ? "" : " btn--primary"}`}
            >
              {currentPlan === "UNLIMITED"
                ? "現在のプラン"
                : loadingPlan === "UNLIMITED"
                  ? "接続しています…"
                  : trialEligible
                    ? "初月0円で始める"
                    : subscriptionUnlimited?.chargedPrice === 0
                      ? "0円で定期購入を始める"
                      : "定期購入で公開し放題プラン"}
            </button>
          </article>
        </div>
        {!trialEligible && (
          <p className="help" style={{ marginTop: "0.75rem" }}>
            初月無料は、はじめての月額プラン加入のみです。
          </p>
        )}
        {error && <Alert tone="error" style={{ marginTop: "1rem" }}>{error}</Alert>}
        <p className="help" style={{ marginTop: "1rem" }}>
          初月無料の終了後は、登録したカードへ自動で請求します。3日前と1日前にメールでお知らせします。詳しくは
          <Link href="/terms" className="text-link">
            利用規約
          </Link>
          をご確認ください。
        </p>
    </Dialog>
  );
}
