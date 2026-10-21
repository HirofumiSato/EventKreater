"use client";

interface LockConflictModalProps {
  isOpen: boolean;
  holderName: string;
  onTakeover: () => Promise<void> | void;
  onRetry: () => Promise<void> | void;
  takingOver: boolean;
}

export function LockConflictModal({
  isOpen,
  holderName,
  onTakeover,
  onRetry,
  takingOver,
}: LockConflictModalProps) {
  if (!isOpen) return null;
  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={() => void onRetry()} />
      <div className="dialog" role="dialog" aria-modal="true">
        <h3 className="dialog__title">編集中のイベントです</h3>
        <p className="dialog__body">{holderName} が編集中です。画面は閲覧専用です。</p>
        <div className="dialog__actions">
          <button type="button" onClick={() => void onTakeover()} disabled={takingOver} className="btn btn--danger btn--block">
            {takingOver ? "引き継いでいます..." : "編集権を引き継ぐ"}
          </button>
          <button type="button" onClick={() => void onRetry()} disabled={takingOver} className="btn btn--block">
            編集権を再取得
          </button>
        </div>
      </div>
    </div>
  );
}
