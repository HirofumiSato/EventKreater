"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** `POST /api/v1/billing/checkout/verify` の応答のうち、画面が使う部分。 */
export interface VerifyPaymentResult {
  draftId?: string | null;
  returnTo?: string | null;
  paymentType?: string;
}

interface VerifyPaymentBannerProps {
  onVerified?: (result: VerifyPaymentResult) => void;
}

export function VerifyPaymentBanner({ onVerified }: VerifyPaymentBannerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sessionId = searchParams.get("session_id");
  const draftIdParam = searchParams.get("draftId");
  const [status, setStatus] = useState<"IDLE" | "VERIFYING" | "SUCCESS" | "ERROR">("IDLE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || status !== "IDLE") return;
    const verify = async () => {
      setStatus("VERIFYING");
      try {
        const res = await fetch("/api/v1/billing/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) {
          const errData = (await res.json()) as { detail?: string };
          throw new Error(errData.detail || "決済の確認に失敗しました。");
        }
        const data = (await res.json()) as VerifyPaymentResult;
        setStatus("SUCCESS");
        onVerified?.(data);
        window.setTimeout(() => {
          // session_id を落とし、復元する下書きだけを残す。戻り先は開いていた画面のまま。
          const draftId = data.draftId ?? draftIdParam;
          router.replace(draftId ? `${pathname}?draftId=${draftId}` : pathname);
        }, 3000);
      } catch (err) {
        setStatus("ERROR");
        setErrorMessage(err instanceof Error ? err.message : "決済の確認が完了できませんでした。");
      }
    };
    void verify();
  }, [sessionId, status, onVerified, router, pathname, draftIdParam]);

  if (status === "IDLE" || !sessionId) return null;

  if (status === "VERIFYING") {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        Stripeでの決済完了を確認しています。
      </p>
    );
  }
  if (status === "SUCCESS") {
    return <p className="alert alert--success">お支払いが確認できました。作成枠が付与されました。</p>;
  }
  return <p className="alert alert--error">{errorMessage || "決済の確認が完了できませんでした。"}</p>;
}
