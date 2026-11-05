"use client";

import { useEffect, useState } from "react";
import type { UserQuota } from "@/modules/events/types";
import type { OneTimeCheckoutResult } from "@/modules/billing/hooks/useEventQuota";
import { ONE_TIME_PRICE_JPY } from "@/modules/billing/lib/plans";
import { yenMark } from "@/lib/format";
import { Alert, Dialog } from "@/components/ui";

export interface TicketPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  quota: UserQuota | null;
  /** 購入または 0 円受け取り。`useEventQuota().startOneTimeCheckout` の戻り値をそのまま返す。 */
  onPurchase: () => Promise<OneTimeCheckoutResult>;
  /** GRANTED のときに呼ぶ。呼び出し元が quota を取り直す。 */
  onGranted?: () => void;
}

/**
 * 単発チケットの購入と 0 円受け取りを、その場で済ませる 1 枚。
 *
 * 月額プランの案内は `/organizer/plan` が持つ。ここは「あと 1 枚」だけを扱い、
 * 0 円キャンペーン中は Stripe へ行かずに付与が返る。
 */
export function TicketPurchaseModal({
  isOpen,
  onClose,
  quota,
  onPurchase,
  onGranted,
}: TicketPurchaseModalProps): JSX.Element | null {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開き直したときに、前回の処理中・エラーの表示を持ち越さない。
  useEffect(() => {
    if (!isOpen) return;
    setLoading(false);
    setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const quote = quota?.pricing?.oneTime ?? null;
  const charged = quote?.chargedPrice ?? ONE_TIME_PRICE_JPY;
  const list = quote?.listPrice ?? ONE_TIME_PRICE_JPY;
  const discounted = charged < list;
  const isFree = charged === 0;
  const remaining = quota?.freeGrantRemaining ?? 0;
  const freeExhausted = isFree && remaining === 0;
  const perUser = quote?.freePerUserLimit ?? 1;

  const handlePurchase = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await onPurchase();
      if (result === "LIMITED") {
        setError("このキャンペーンでの受け取りは上限に達しています。");
        setLoading(false);
        return;
      }
      // GRANTED は呼び出し元が残数を読み直す。REDIRECT と PHONE_REQUIRED は画面が変わる。
      if (result === "GRANTED") onGranted?.();
      setLoading(false);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "単発チケットの購入に失敗しました");
      setLoading(false);
    }
  };

  return (
    <Dialog
      title="単発チケット"
      onClose={onClose}
      actions={
        <button type="button" onClick={onClose} disabled={loading} className="btn btn--ghost btn--block">
          閉じる
        </button>
      }
    >
      <div className="dialog__body">
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
        <p>
          1枚。次のライブや次の会に。
          {isFree && ` おひとり${perUser}枚まで無料です。 残り${remaining}枚。`}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void handlePurchase()}
        disabled={loading || freeExhausted}
        className="btn btn--primary btn--block"
        style={{ marginTop: "1.25rem" }}
      >
        {loading
          ? "処理しています…"
          : freeExhausted
            ? "受け取り済みです"
            : isFree
              ? "無料で受け取る"
              : "単発チケットを買う"}
      </button>
      {error && (
        <Alert tone="error" style={{ marginTop: "1rem" }}>
          {error}
        </Alert>
      )}
    </Dialog>
  );
}
