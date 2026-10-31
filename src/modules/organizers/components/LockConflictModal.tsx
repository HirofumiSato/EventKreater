"use client";

import { Dialog } from "@/components/ui";

interface LockConflictModalProps {
  isOpen: boolean;
  holderName: string;
  /** 編集権を奪う。相手の未保存の編集は反映されない。 */
  onTakeover: () => Promise<void> | void;
  /** 閉じる。ロックは取らず、閲覧のみのまま画面に残る。 */
  onDismiss: () => void;
  takingOver: boolean;
}

/**
 * SCR-MOD-02。他の幹事が編集中のときの案内。
 *
 * 選べるのは 2 つだけ。編集権を引き継ぐか、閉じて閲覧のみで眺めるかである。
 * ロックの再取得は裏で 15 秒ごとに試しているので、手で押す「再取得」は置かない。
 * 押しても同じ 409 が返るだけで、ボタンの違いが伝わらないため。
 *
 * 閉じる道は右上の印・背景・下のボタンの 3 つ。どれも `onDismiss` に落とすので、
 * 閉じたあとは閲覧のみのまま画面に残る（モーダルが開き直ることはない）。
 */
export function LockConflictModal({ isOpen, holderName, onTakeover, onDismiss, takingOver }: LockConflictModalProps) {
  if (!isOpen) return null;
  return (
    <Dialog
      title="編集中のイベントです"
      titleId="lock-conflict-title"
      onClose={onDismiss}
      closeLabel="引き続き閲覧のみ"
      actions={
        <>
          <button
            type="button"
            onClick={() => void onTakeover()}
            disabled={takingOver}
            className="btn btn--danger btn--block"
          >
            {takingOver ? "引き継いでいます…" : "編集権を引き継ぐ"}
          </button>
          <button type="button" onClick={onDismiss} disabled={takingOver} className="btn btn--ghost btn--block">
            引き続き閲覧のみ
          </button>
        </>
      }
    >
      <p className="dialog__body">{holderName}さんが編集中です。いまは閲覧のみです。</p>
      <p className="dialog__note">引き継ぐと、相手の未保存の編集は反映されません。</p>
    </Dialog>
  );
}
