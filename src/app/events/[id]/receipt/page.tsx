"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptSheet } from "@/modules/receipts/components/ReceiptSheet";
import { readProblem } from "@/lib/problem";
import type { ReceiptView } from "@/modules/events/types";

export default function ParticipantReceiptPage({ params }: { params: { id: string } }) {
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/public/events/${params.id}/receipt`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as { receipt: ReceiptView };
      })
      .then((body) => {
        if (active) setReceipt(body.receipt);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
      });
    return () => {
      active = false;
    };
  }, [params.id]);

  if (error) return <p className="alert alert--error">{error}</p>;
  if (!receipt) {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        領収書を読み込んでいます
      </p>
    );
  }

  return (
    <div className="stack">
      <p className="no-print">
        <Link href={`/events/${params.id}`} className="text-link">
          告知へ戻る
        </Link>
      </p>
      <ReceiptSheet receipt={receipt} />
    </div>
  );
}
