"use client";

interface EventLifecycleModalProps {
  title: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  busy: boolean;
  onClose: () => void;
  onStop: () => void;
  onDelete: () => void;
}

export function EventLifecycleModal({ title, status, busy, onClose, onStop, onDelete }: EventLifecycleModalProps) {
  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title">
        <h3 id="lifecycle-title" className="dialog__title">
          イベント削除・停止確認
        </h3>
        <p className="dialog__body">
          {title}。受付停止は告知ページを残し、出欠だけを止めます。完全削除は一覧と告知URLから外します。出欠の記録は残ります。
        </p>
        <div className="dialog__actions">
          <button type="button" className="btn btn--block" disabled={busy || status === "CLOSED"} onClick={onStop}>
            {status === "CLOSED" ? "すでに受付停止です" : "出欠受付を停止する"}
          </button>
          <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
            完全に削除する
          </button>
          <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={onClose}>
            戻る
          </button>
        </div>
      </div>
    </div>
  );
}
