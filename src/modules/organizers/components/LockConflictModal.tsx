"use client";

import { Dialog } from "@/components/ui";

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
    <Dialog
      title="編集中のイベントです"
      onClose={() => void onRetry()}
      actions={<><button type="button" onClick={() => void onTakeover()} disabled={takingOver} className="btn btn--danger btn--block">
            {takingOver ? "引き継いでいます..." : "編集権を引き継ぐ"}
          </button>
          <button type="button" onClick={() => void onRetry()} disabled={takingOver} className="btn btn--block">
            編集権を再取得
          </button></>}
    >
      <p className="dialog__body">{holderName} が編集中です。画面は閲覧専用です。</p>
    </Dialog>
  );
}
