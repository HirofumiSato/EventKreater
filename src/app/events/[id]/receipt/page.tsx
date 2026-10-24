"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptSheet } from "@/modules/receipts/components/ReceiptSheet";
import { readProblem } from "@/lib/problem";
import type { ReceiptView } from "@/modules/events/types";
import { Alert, Loading } from "@/components/ui";

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

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!receipt) {
    return (
      <Loading>
        領収書を読み込んでいます
      </Loading>
    );
  }

  return (
    <div className="stack">
      <div className="no-print">
        <p className="eyebrow">領収書</p>
        <h1 className="page-title">参加費の領収書</h1>
        <p className="page-lead">{receipt.eventTitle}</p>
      </div>
      <ReceiptSheet receipt={receipt} />
      <div className="panel__actions no-print">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => window.print()}>
          印刷する
        </button>
        <Link href="/participant/history" className="btn btn--outline btn--sm">
          参加履歴へ戻る
        </Link>
        <Link href={`/events/${params.id}`} className="btn btn--ghost btn--sm">
          告知へ戻る
        </Link>
      </div>
      <p className="screen-note no-print">
        印刷では、この用紙だけを出します。ヘッダーとフッターは印刷されません。
      </p>
    </div>
  );
}
