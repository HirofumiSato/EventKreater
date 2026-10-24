"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui";

interface PublishSuccessModalProps {
  publicUrl: string;
  manageUrl: string;
  onClose: () => void;
}

export function PublishSuccessModal({ publicUrl, manageUrl, onClose }: PublishSuccessModalProps) {
  const [copied, setCopied] = useState(false);
  const absolute = typeof window === "undefined" ? publicUrl : `${window.location.origin}${publicUrl}`;

  const copy = async () => {
    await navigator.clipboard.writeText(absolute);
    setCopied(true);
  };

  return (
    <Dialog
      title="公開完了"
      onClose={onClose}
      actions={<><button type="button" onClick={() => void copy()} className="btn btn--primary btn--block">
            {copied ? "コピーしました" : "共有リンクをコピー"}
          </button>
          <a href={publicUrl} className="btn btn--block">
            公開ページを開く
          </a>
          <a href={manageUrl} className="btn btn--outline btn--block">
            管理画面へ
          </a>
          <button type="button" onClick={onClose} className="btn btn--ghost btn--block">
            閉じる
          </button></>}
    >
      <p className="dialog__body">共有リンクを参加者に送って、出欠を集められます。</p>
        <p className="quote">{absolute}</p>
    </Dialog>
  );
}
