"use client";

import { useState } from "react";
import { readProblem } from "@/lib/problem";

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
      setError(cause instanceof Error ? cause.message : "カスタマーポータルを開けませんでした。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <span>
      <button type="button" onClick={() => void handleOpenPortal()} disabled={isLoading} className="btn btn--outline btn--sm">
        {isLoading ? "接続中..." : "プラン・カード管理"}
      </button>
      {error && <p className="field-error">{error}</p>}
    </span>
  );
}
