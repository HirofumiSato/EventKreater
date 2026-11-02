"use client";

import { Dialog } from "@/components/ui";
import type { PublishConfirmation } from "@/modules/billing/lib/publish-confirm";

interface PublishConfirmModalProps {
  eventTitle: string;
  confirmation: PublishConfirmation;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * 種類ごとの題と、使うものの呼び方。単位はすべて枚。
 * 本文は「何を1枚使うか」と「公開するとどうなるか」だけを言い、残りは注記へ回す。
 */
const CONFIRM_TEXT: Record<
  PublishConfirmation["kind"],
  { title: string; used: string }
> = {
  FREE_TICKET: { title: "チケットを使って公開しますか？", used: "チケットを1枚使います" },
  PAID_CREDIT: { title: "単発チケットを使って公開しますか？", used: "単発チケットを1枚使います" },
  FREE_TRIAL: { title: "無料チケットを使って公開しますか？", used: "無料チケットを1枚使います" },
};

/**
 * 公開する直前に、何を1枚使うかを見せる確認の層。
 * 定額プラン中と、チケットが無くて料金モーダルへ移るときは呼び出し元がこの層を出さない。
 * 閉じる道（背景・右上・Escape・「やめる」）はすべて `onClose` に集める。
 */
export function PublishConfirmModal({
  eventTitle,
  confirmation,
  busy,
  onClose,
  onConfirm,
}: PublishConfirmModalProps) {
  const { title, used } = CONFIRM_TEXT[confirmation.kind];

  return (
    <Dialog
      title={title}
      titleId="publish-confirm-title"
      closeLabel="公開をやめる"
      onClose={onClose}
      actions={<>
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "公開中…" : "公開する"}
        </button>
        <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={onClose}>
          やめる
        </button>
      </>}
    >
      <p className="dialog__body">
        {`${eventTitle}。${used}。公開すると、告知URLが有効になり出欠を受け付けます。`}
      </p>
      <p className="dialog__note">残りチケット数：{confirmation.remaining}枚</p>
    </Dialog>
  );
}
