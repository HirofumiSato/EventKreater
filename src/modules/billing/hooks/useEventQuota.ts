"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuotaSeed, UserQuota } from "@/modules/events/types";
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

/**
 * チケット・プランの残りと、購入の導線を持つ。
 *
 * `seed` はサーバーコンポーネントが読んだ初期値。`ready` なら最初の HTML に帯が載り、
 * ハイドレーション後に `/api/v1/billing/quota` を取りに行かない。`signed-out` も
 * 取りに行かない（応答は 401 で、帯は出ない）。`unknown` と未指定だけ従来どおり取りに行く。
 * 付与・公開・決済の確認のあとの `refreshQuota()` は、初期値の有無に関わらず飛ばす。
 */
export function useEventQuota(seed?: QuotaSeed) {
  // サーバーが読んだ初期値。`ready` はそのまま、`signed-out` は「無い」で確定。
  // `unknown` と未指定だけ、今までどおりマウント後に取りに行く。
  const seeded = seed?.status === "ready" ? seed.quota : null;
  const settled = seed?.status === "ready" || seed?.status === "signed-out";
  const [quota, setQuota] = useState<UserQuota | null>(seeded);
  const [isLoading, setIsLoading] = useState(!settled);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  // モーダルを開いた画面の文脈。購入後の戻り先と、復元する下書きを引き継ぐ。
  const intentRef = useRef<CheckoutIntent | undefined>(undefined);

  /**
   * チケットを取得し、取れた値をそのまま返す。
   * 押した直後の判定に使えるよう、state を待たずに最新の残数を渡すため。
   * 取得に失敗したときは null を返し、呼び出し元は手元の値で判断する。
   *
   * `bypassHttpCache` は、書き込みの直後に読み直すときだけ true にする。
   * 応答は `Cache-Control: private, max-age=30` なので、素の fetch は 30 秒ぶん
   * ブラウザの HTTP キャッシュから返り、0円で付与したチケットが画面に出ない。
   */
  const loadQuota = useCallback(async (bypassHttpCache: boolean): Promise<UserQuota | null> => {
    try {
      const res = await fetch(
        "/api/v1/billing/quota",
        bypassHttpCache ? { cache: "no-store" } : undefined,
      );
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

  /** 画面を開いたときと、課金のモーダルを開いたとき。30 秒のキャッシュを使ってよい。 */
  const fetchQuota = useCallback(() => loadQuota(false), [loadQuota]);
  /**
   * 付与・公開・決済の確認のあとに呼ばれる取り直し。HTTP キャッシュを飛ばして、
   * 書き込み後の残数を必ず読む。
   */
  const refreshQuota = useCallback(() => loadQuota(true), [loadQuota]);

  useEffect(() => {
    // サーバーが初期値を渡した画面は、ハイドレーション後に取りに行かない。
    if (settled) return;
    void fetchQuota();
  }, [fetchQuota, settled]);

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
      // 0円の枠が尽きた・付与された直後は、HTTP キャッシュではなく書いた後の値を読む。
      await refreshQuota();
      return "LIMITED";
    }
    if (data.granted) {
      await refreshQuota();
      return "GRANTED";
    }
    if (data.checkoutUrl) {
      // Stripe へ進む購入開始の回数。0円で付与された経路はここへ来ない。
      trackEvent("begin_checkout", { payment: "one_time" });
      window.location.href = data.checkoutUrl;
      return "REDIRECT";
    }
    throw new Error("単発決済セッション作成に失敗しました");
  }, [refreshQuota]);

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
    refreshQuota,
    startOneTimeCheckout,
    startSubscriptionCheckout,
  };
}
