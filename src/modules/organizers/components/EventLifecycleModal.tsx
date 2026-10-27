"use client";

import { Dialog } from "@/components/ui";

interface EventLifecycleModalProps {
  title: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}

/**
 * 削除の確認。
 *
 * 受付停止（公開の一時停止）は元に戻せる操作なので確認を挟まず、カードの
 * 「共有と設定」から直接実行する。ここは元に戻せない削除だけを持つ。
 * 下書きに受付停止は無い（告知ページも出欠もまだ無い）。片付ける手段は削除だけ。
 */
export function EventLifecycleModal({ title, status, busy, onClose, onDelete }: EventLifecycleModalProps) {
  const isDraft = status === "DRAFT";
  return (
    <Dialog
      title={<>{isDraft ? "下書きの削除確認" : "イベントの削除確認"}</>}
      titleId="lifecycle-title"
      onClose={onClose}
      actions={<>
          <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
            {isDraft ? "下書きを削除する" : "完全に削除する"}
          </button>
          <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={onClose}>
            戻る
          </button></>}
    >
      <p className="dialog__body">
        {isDraft
          ? `${title}。下書きを削除します。入力した内容は元に戻せません。利用枠は消費していません。`
          : `${title}。削除すると、一覧と告知URLから外れます。出欠の記録は残りますが、元に戻せません。出欠だけを止めたいときは「公開を一時停止」を使ってください。`}
      </p>
    </Dialog>
  );
}
