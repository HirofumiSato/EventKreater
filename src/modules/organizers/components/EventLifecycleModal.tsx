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
  // 下書きに受付停止は無い（告知ページも出欠もまだ無い）。片付ける手段は削除だけ。
  const isDraft = status === "DRAFT";
  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title">
        <h3 id="lifecycle-title" className="dialog__title">
          {isDraft ? "下書きの削除確認" : "イベント削除・停止確認"}
        </h3>
        <p className="dialog__body">
          {isDraft
            ? `${title}。下書きを削除します。入力した内容は元に戻せません。利用枠は消費していません。`
            : `${title}。受付停止は告知ページを残し、出欠だけを止めます。完全削除は一覧と告知URLから外します。出欠の記録は残ります。`}
        </p>
        <div className="dialog__actions">
          {!isDraft && (
            <button type="button" className="btn btn--block" disabled={busy || status === "CLOSED"} onClick={onStop}>
              {status === "CLOSED" ? "すでに受付停止です" : "出欠受付を停止する"}
            </button>
          )}
          <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={onDelete}>
            {isDraft ? "下書きを削除する" : "完全に削除する"}
          </button>
          <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={onClose}>
            戻る
          </button>
        </div>
      </div>
    </div>
  );
}
