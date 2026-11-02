"use client";

import { Dialog } from "@/components/ui";

interface PublishUsedModalProps {
  eventTitle: string;
  remaining: number;
  onClose: () => void;
}

/**
 * チケットを1枚使って公開できたことを知らせる層。
 *
 * 確認を経た公開のあとに出す。閉じる道（背景・右上・Escape・「告知ページを見る」）は
 * すべて `onClose` に集め、呼び出し元が告知ページへ移る。
 */
export function PublishUsedModal({ eventTitle, remaining, onClose }: PublishUsedModalProps) {
  return (
    <Dialog
      title="チケットを使いました"
      titleId="publish-used-title"
      onClose={onClose}
      actions={
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          告知ページを見る
        </button>
      }
    >
      <p className="dialog__body">{`「${eventTitle}」を公開しました。`}</p>
      <p className="dialog__note">残りチケット数：{remaining}枚</p>
    </Dialog>
  );
}
