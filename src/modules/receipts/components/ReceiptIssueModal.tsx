"use client";

import { useState, type FormEvent } from "react";
import { Alert, Field } from "@/components/ui";

interface ReceiptIssueModalProps {
  participantName: string;
  suggestedDescription: string;
  /** 選んだ費用プランの金額。0円なら領収書は発行しない。 */
  suggestedAmount?: number | null;
  reissue: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { addressee: string; amount: number; description: string }) => Promise<void>;
}

export function ReceiptIssueModal({
  participantName,
  suggestedDescription,
  suggestedAmount = null,
  reissue,
  busy,
  onClose,
  onSubmit,
}: ReceiptIssueModalProps) {
  const [addressee, setAddressee] = useState(participantName);
  const [amount, setAmount] = useState(
    suggestedAmount !== null && suggestedAmount > 0 ? String(suggestedAmount) : "",
  );
  const [description, setDescription] = useState(suggestedDescription.slice(0, 100) || "イベント参加費");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number(amount);
    if (!Number.isInteger(parsed) || parsed < 1) return;
    await onSubmit({ addressee: addressee.trim(), amount: parsed, description: description.trim() });
  };

  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={onClose} />
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-title" onSubmit={(event) => void submit(event)}>
        <h3 id="receipt-title" className="dialog__title">
          {reissue ? "領収書を再発行" : "領収書を発行"}
        </h3>
        <p className="dialog__body">
          宛名、金額、但し書きを入れて発行します。金額は選んだ費用プランから入れています。参加費の決済はこのシステムでは行いません。
        </p>
        {suggestedAmount === 0 && (
          <Alert tone="warning">
            この費用プランは無料です。領収書が必要かどうか確認してください。
          </Alert>
        )}
        <Field label="宛名" htmlFor="receipt-addressee">
          <input
            id="receipt-addressee"
            required
            maxLength={100}
            className="input"
            value={addressee}
            onChange={(event) => setAddressee(event.target.value)}
          />
        </Field>
        <Field label="金額（円）" htmlFor="receipt-amount">
          <input
            id="receipt-amount"
            required
            type="number"
            min={1}
            max={9999999}
            step={1}
            className="input"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="但し書き" htmlFor="receipt-description">
          <input
            id="receipt-description"
            required
            maxLength={100}
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="dialog__actions">
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? "発行しています..." : reissue ? "再発行して表示" : "発行して表示"}
          </button>
          <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={onClose}>
            閉じる
          </button>
        </div>
      </form>
    </div>
  );
}
