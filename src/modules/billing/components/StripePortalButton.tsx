"use client";

import { useState } from "react";
import { readProblem } from "@/lib/problem";

interface StripePortalButtonProps {
  /** ボタンの文言。既定は「カードを変更・解約」。 */
  label?: string;
  /** 呼び出し元の Alert に出すための通知。画面内に <p> を出さない。 */
  onError?: (message: string) => void;
  className?: string;
}

/**
 * プラン画面の操作。ヘッダーのメニューは `/organizer/plan` へのリンクになった。
 *
 * Stripe の Customer Portal（解約・カード変更）を開く。行き先ではなく操作なので、
 * 置き場所はプラン画面の「カードを変更・解約」だけになる。文言・余白は呼び出し側が
 * `label` / `className` で決める（既定は画面の幅いっぱいに置く枠線のボタン）。
 *
 * 失敗は画面の `Alert` に 1 か所でまとめたいので、`onError` があればそちらへ渡す。
 * 受け取らない使い道（メニューなど）を壊さないよう、無ければこの中に 1 行で出す。
 */
export function StripePortalButton({
  label = "カードを変更・解約",
  onError,
  className = "btn btn--outline btn--block",
}: StripePortalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenPortal = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/billing/portal", { method: "POST" });
      if (!res.ok) throw new Error(await readProblem(res));
      const data = (await res.json()) as { portalUrl?: string };
      if (data.portalUrl) window.location.href = data.portalUrl;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "プランとカードの管理を開けませんでした。";
      if (onError) onError(message);
      else setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => void handleOpenPortal()}
        disabled={isLoading}
      >
        {isLoading ? "接続しています…" : label}
      </button>
      {error && (
        <p className="site-user-menu__note" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
