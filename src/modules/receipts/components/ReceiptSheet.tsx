"use client";

import type { ReceiptView } from "@/modules/events/types";

interface ReceiptSheetProps {
  receipt: ReceiptView;
}

/* 紙として読ませる。画面では貼り紙の装飾を外し、白い用紙 1 枚に見せる。
   印刷では影も地紋も落ちる（@media print）。 */
export function ReceiptSheet({ receipt }: ReceiptSheetProps) {
  const issued = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(receipt.issuedAt));

  return (
    <article className="receipt-sheet">
      <p className="receipt-sheet__title">領収書</p>
      <p className="receipt-sheet__no">No. {receipt.id}</p>

      <p className="receipt-sheet__to">{receipt.addressee} 様</p>

      <p className="receipt-sheet__amount">￥{receipt.amount.toLocaleString("ja-JP")}</p>
      <p className="receipt-sheet__tax">（消費税込み）</p>

      <div className="receipt-sheet__lines">
        <div className="receipt-sheet__line">
          <span>但し書き</span>
          <span>{receipt.description}</span>
        </div>
        <div className="receipt-sheet__line">
          <span>催し名</span>
          <span>{receipt.eventTitle}</span>
        </div>
        <div className="receipt-sheet__line">
          <span>受領日</span>
          <span>{issued}</span>
        </div>
        <div className="receipt-sheet__line">
          <span>発行者</span>
          <span>{receipt.issuerName}</span>
        </div>
      </div>

      <p className="receipt-sheet__foot">
        上記の金額を正に領収しました。参加費の集金はこのシステムでは行っていません。
        この領収書は、主催者が発行したものです。再発行は、同じページから何度でも行えます。
      </p>

      <div className="panel__actions no-print">
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          印刷する
        </button>
      </div>
    </article>
  );
}
