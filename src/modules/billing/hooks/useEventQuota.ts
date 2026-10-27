"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserQuota } from "@/modules/events/types";
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

  const fetchQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/billing/quota");
      if (res.ok) {
        const data = (await res.json()) as UserQuota;
        setQuota(data);
      } else {
        setQuota(null);
      }
    } catch (error) {
      console.error("クォータ取得に失敗しました", error);
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
      setIsPricingModalOpen(true);
    },
    [fetchQuota],
  );

  /**
   * 0円キャンペーン中は Stripe へ行かず、その場で1回分が付与される。
   * 付与されたら枠を読み直して、作成画面がそのまま再試行できるようにする。
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
        window.location.href = data.checkoutUrl;
      }
    },
    [],
  );

  const openCustomerPortal = useCallback(async () => {
    const res = await fetch("/api/v1/billing/portal", { method: "POST" });
    if (!res.ok) throw new Error("ポータルセッション作成に失敗しました");
    const data = (await res.json()) as { portalUrl?: string };
    if (data.portalUrl) {
      window.location.href = data.portalUrl;
    }
  }, []);

  return {
    quota,
    isLoading,
    isPricingModalOpen,
    openPricingModal,
    closePricingModal: () => setIsPricingModalOpen(false),
    refreshQuota: fetchQuota,
    startOneTimeCheckout,
    startSubscriptionCheckout,
    openCustomerPortal,
  };
}
