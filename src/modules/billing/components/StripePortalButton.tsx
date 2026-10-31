"use client";

import { useState } from "react";
import { readProblem } from "@/lib/problem";

/**
 * Stripe の Customer Portal（解約・カード変更）を開く操作。
 *
 * 置き場所は共通ヘッダーの頭文字のメニューだけ。マイページの「利用枠と契約」の節は
 * 畳んだので、契約の入口はここが受ける。行き先ではなく操作なので、見た目は
 * メニューのリンク（`.site-user-menu__link`）にそろえた `<button>` で出す。
 * 主催者として見ているあいだだけ描く（参加者画面では契約を持たない）。
 */
export function StripePortalButton() {
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
      setError(cause instanceof Error ? cause.message : "プランとカードの管理を開けませんでした。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="site-user-menu__link site-user-menu__link--button"
        onClick={() => void handleOpenPortal()}
        disabled={isLoading}
      >
        {isLoading ? "接続しています…" : "プラン・カード管理"}
      </button>
      {error && (
        <p className="site-user-menu__note" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
