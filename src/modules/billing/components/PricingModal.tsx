"use client";

import Link from "next/link";
import { useState } from "react";
import { ONE_TIME_PRICE_JPY, SUBSCRIPTION_PRICE_JPY } from "@/modules/billing/lib/plans";
import type { PricingQuote } from "@/modules/events/types";
import { yenMark } from "@/lib/format";
import { Alert, Dialog } from "@/components/ui";

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOneTime: () => Promise<unknown>;
  onSelectSubscription: () => Promise<unknown>;
  /** いまの販売価格。無いときは定価で表示する。 */
  quotes?: { oneTime: PricingQuote; subscription: PricingQuote } | null;
  freeGrantRemaining?: number;
  onGranted?: () => void;
  /** 開いた画面。キャンセル時の文言を合わせる。 */
  context?: "create" | "edit" | "preview" | "list" | "mypage";
}

const CANCEL_LABEL: Record<NonNullable<PricingModalProps["context"]>, string> = {
  create: "キャンセルして作成に戻る",
  edit: "キャンセルして編集に戻る",
  preview: "キャンセルしてプレビューに戻る",
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
      {discounted && deadline && (
        <p className="help">
          {quote?.campaignEndsAt ? `${endsAtLabel(quote.campaignEndsAt)} まで` : ""}
          {quote?.target === "SUBSCRIPTION" ? "（加入から割引月数ぶん適用）" : ""}
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
  onGranted,
  context = "list",
}: PricingModalProps) {
  const [loadingPlan, setLoadingPlan] = useState<"SINGLE" | "SUB" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const oneTime = quotes?.oneTime ?? null;
  const subscription = quotes?.subscription ?? null;
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

  const handleSubscription = async () => {
    setLoadingPlan("SUB");
    setError(null);
    try {
      await onSelectSubscription();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "サブスクリプションセッション作成に失敗しました");
      setLoadingPlan(null);
    }
  };

  return (
    <Dialog
      title="課金プラン選択"
      onClose={onClose}
      actions={<><button type="button" onClick={onClose} disabled={loadingPlan !== null} className="btn btn--ghost btn--block">
            {CANCEL_LABEL[context]}
          </button></>}
    >
      <p className="dialog__body">継続して告知ページを作るには、次のどちらかを選びます。</p>
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
                ? "処理中..."
                : freeExhausted
                  ? "このキャンペーンは受け取り済みです"
                  : isFree
                    ? "無料で受け取る"
                    : "単発で購入する"}
            </button>
          </article>
          <article className="card" style={{ borderTop: "3px solid var(--color-primary)" }}>
            <p className="eyebrow">月4回以上でおトク</p>
            <h4 className="card__title">月額使い放題</h4>
            <PriceBlock quote={subscription} fallback={SUBSCRIPTION_PRICE_JPY} />
            <p className="card__body">
              生成無制限、共同主催者の招待、複製。
              {subscription?.chargedPrice === 0
                ? " 無料期間の終了後は、登録したカードへ自動で請求します。"
                : ""}
            </p>
            <button
              type="button"
              onClick={() => void handleSubscription()}
              disabled={loadingPlan !== null}
              className="btn btn--primary btn--block"
            >
              {loadingPlan === "SUB"
                ? "Stripeへ接続中..."
                : subscription?.chargedPrice === 0
                  ? "0円で定期購入を始める"
                  : "定期購入で使い放題"}
            </button>
          </article>
        </div>
        {error && <p className="alert alert--error" style={{ marginTop: "1rem" }}>{error}</p>}
        <p className="help" style={{ marginTop: "1rem" }}>
          0円の月額は無料期間の終了後に自動で有料へ切り替わります。終了の3日前と1日前にメールでお知らせします。詳しくは
          <Link href="/terms" className="text-link">
            利用規約
          </Link>
          をご確認ください。
        </p>
    </Dialog>
  );
}
