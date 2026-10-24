"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptIssueModal } from "@/modules/receipts/components/ReceiptIssueModal";
import { ReceiptSheet } from "@/modules/receipts/components/ReceiptSheet";
import { isRegisterRequired, readProblem, readProblemBody, sendToRegisterRequired } from "@/lib/problem";
import type { ReceiptView } from "@/modules/events/types";

export default function OrganizerReceiptPage({ params }: { params: { id: string; participantId: string } }) {
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reissuing, setReissuing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/organizer/events/${params.id}/participants/${params.participantId}/receipt`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await readProblemBody(res);
          if (isRegisterRequired(body)) {
            sendToRegisterRequired(params.id);
            throw new Error("領収書の発行には会員登録が必要です。案内ページへ移動しています。");
          }
          throw new Error(body.detail || "読み込みに失敗しました");
        }
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
  }, [params.id, params.participantId]);

  const reissue = async (input: { addressee: string; amount: number; description: string }) => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/v1/organizer/events/${params.id}/participants/${params.participantId}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { receipt: ReceiptView };
      setReceipt(body.receipt);
      setReissuing(false);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "再発行に失敗しました");
    } finally {
      setBusy(false);
    }
  };

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
      <div className="no-print">
        <p className="eyebrow">主催者</p>
        <h1 className="page-title">領収書</h1>
        <p className="page-lead">
          {receipt.eventTitle} ／ {receipt.addressee} さん
        </p>
      </div>
      <div className="panel no-print">
        <div className="panel__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setReissuing(true)}>
            再発行する
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => window.print()}>
            印刷する
          </button>
          <Link href={`/organizer/events/${params.id}/participants`} className="btn btn--ghost btn--sm">
            名簿へ戻る
          </Link>
        </div>
        <p className="screen-note">
          再発行すると、同じ番号で新しい発行日が入ります。番号は変わりません。
        </p>
      </div>
      {formError && <p className="alert alert--error no-print">{formError}</p>}
      <ReceiptSheet receipt={receipt} />
      {reissuing && (
        <ReceiptIssueModal
          participantName={receipt.addressee}
          suggestedDescription={receipt.description}
          reissue
          busy={busy}
          onClose={() => setReissuing(false)}
          onSubmit={reissue}
        />
      )}
    </div>
  );
}
