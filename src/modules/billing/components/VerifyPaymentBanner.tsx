"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface VerifyPaymentBannerProps {
  onVerified: () => void;
}

export function VerifyPaymentBanner({ onVerified }: VerifyPaymentBannerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");
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
        setStatus("SUCCESS");
        onVerified();
        window.setTimeout(() => {
          router.replace("/organizer/events/new");
        }, 3000);
      } catch (err) {
        setStatus("ERROR");
        setErrorMessage(err instanceof Error ? err.message : "決済の確認が完了できませんでした。");
      }
    };
    void verify();
  }, [sessionId, status, onVerified, router]);

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
