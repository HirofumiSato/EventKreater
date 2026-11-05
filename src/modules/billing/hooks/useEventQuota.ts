"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserQuota } from "@/modules/events/types";
import { trackEvent } from "@/lib/analytics";
import { problemMessage, readProblemBody } from "@/lib/problem";
import { phoneVerifyUrl } from "@/lib/auth-links";
import { SITE } from "@/lib/site";

export type OneTimeCheckoutResult = "GRANTED" | "LIMITED" | "REDIRECT" | "PHONE_REQUIRED";

/** 課金を開いた画面と、購入後に復元する下書き。 */
export interface CheckoutIntent {
  draftId?: string;
  returnTo?: string;
}

const DEFAULT_RETURN_TO = SITE.nav.createEvent.href;

function checkoutBody(intent?: CheckoutIntent): string {
  return JSON.stringify(intent ?? {});
}

export function useEventQuota() {
  const [quota, setQuota] = useState<UserQuota | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  // モーダルを開いた画面の文脈。購入後の戻り先と、復元する下書きを引き継ぐ。
  const intentRef = useRef<CheckoutIntent | undefined>(undefined);

  /**
   * チケットを取り直し、取れた値をそのまま返す。
   * 押した直後の判定に使えるよう、state を待たずに最新の残数を渡すため。
   * 取得に失敗したときは null を返し、呼び出し元は手元の値で判断する。
   */
  const fetchQuota = useCallback(async (): Promise<UserQuota | null> => {
    try {
      const res = await fetch("/api/v1/billing/quota");
      if (!res.ok) {
        setQuota(null);
        return null;
      }
      const data = (await res.json()) as UserQuota;
      setQuota(data);
      return data;
    } catch (error) {
      console.error("クォータ取得に失敗しました", error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchQuota();
  }, [fetchQuota]);

  const openPricingModal = useCallback(
    (intent?: CheckoutIntent) => {
      intentRef.current = intent;
      // 開くたびに最新の販売価格を取り直す。
      void fetchQuota();
      // 公開し放題プランは公開中の件数に上限がないので、選ぶものが無い。
      if (quota?.subscriptionPlan === "UNLIMITED" && quota.subscriptionStatus === "ACTIVE") return;
      setIsPricingModalOpen(true);
    },
    [fetchQuota, quota?.subscriptionPlan, quota?.subscriptionStatus],
  );

  /**
   * 0円キャンペーン中は Stripe へ行かず、その場で1枚が付与される。
   * 付与されたらチケットを読み直して、作成画面がそのまま再試行できるようにする。
   */
  const startOneTimeCheckout = useCallback(
    async (override?: CheckoutIntent): Promise<OneTimeCheckoutResult> => {
      const intent = override ?? intentRef.current;
      const res = await fetch("/api/v1/billing/checkout/one-time", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: checkoutBody(intent),
      });
      if (!res.ok) {
        const problem = await readProblemBody(res);
        if (problem.error === "PHONE_REQUIRED") {
          window.location.href = phoneVerifyUrl(intent?.returnTo ?? DEFAULT_RETURN_TO);
          return "PHONE_REQUIRED";
        }
        throw new Error(problemMessage(problem, "単発決済セッション作成に失敗しました"));
      }
    const data = (await res.json()) as {
      checkoutUrl?: string;
      granted?: boolean;
      limited?: boolean;
    };
    if (data.limited) {
      await fetchQuota();
      return "LIMITED";
    }
    if (data.granted) {
      await fetchQuota();
      return "GRANTED";
    }
    if (data.checkoutUrl) {
      // Stripe へ進む購入開始の回数。0円で付与された経路はここへ来ない。
      trackEvent("begin_checkout", { payment: "one_time" });
      window.location.href = data.checkoutUrl;
      return "REDIRECT";
    }
    throw new Error("単発決済セッション作成に失敗しました");
  }, [fetchQuota]);

  const startSubscriptionCheckout = useCallback(
    async (plan: "MONTHLY_8" | "UNLIMITED", override?: CheckoutIntent) => {
      const intent = override ?? intentRef.current;
      const res = await fetch("/api/v1/billing/checkout/subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ ...(intent ?? {}), plan }),
      });
      if (!res.ok) {
        throw new Error(problemMessage(await readProblemBody(res), "サブスクセッション作成に失敗しました"));
      }
      const data = (await res.json()) as { checkoutUrl?: string };
      if (data.checkoutUrl) {
        // Stripe へ進む購入開始の回数。どのプランかは引数の値をそのまま載せる。
        trackEvent("begin_checkout", { payment: "subscription", plan });
        window.location.href = data.checkoutUrl;
      }
    },
    [],
  );

  return {
    quota,
    isLoading,
    isPricingModalOpen,
    openPricingModal,
    closePricingModal: () => setIsPricingModalOpen(false),
    refreshQuota: fetchQuota,
    startOneTimeCheckout,
    startSubscriptionCheckout,
  };
}
