"use client";

import type { ReceiptView } from "@/modules/events/types";

interface ReceiptSheetProps {
  receipt: ReceiptView;
}

export function ReceiptSheet({ receipt }: ReceiptSheetProps) {
  const issued = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(receipt.issuedAt));

  return (
    <article className="receipt">
      <p className="eyebrow">領収書</p>
      <h1 className="receipt__title">領収書</h1>
      <p className="receipt__addressee">{receipt.addressee} 様</p>
      <p className="receipt__amount">¥{receipt.amount.toLocaleString("ja-JP")}</p>
      <p className="receipt__line">但し {receipt.description}</p>
      <p className="receipt__line">{receipt.eventTitle}</p>
      <p className="receipt__line">発行日 {issued}</p>
      <p className="receipt__line">発行者 {receipt.issuerName}</p>
      <p className="help">上記の金額を正に領収しました。参加費の集金はこのシステムでは行っていません。</p>
      <button type="button" className="btn btn--primary no-print" onClick={() => window.print()}>
        印刷する
      </button>
    </article>
  );
}
