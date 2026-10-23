"use client";

import { useEffect, useRef } from "react";

interface LineShareDialogProps {
  /** 押した時点で本文から組み立てた LINE の共有 URL。 */
  href: string;
  onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled])';

/**
 * LINE を開く前の注意書き。
 * 送信は利用者の個人アカウントから行われ、停止されうることを、送る直前に読ませる。
 * 同意した場合だけ中のリンクを踏ませ、アプリからは自動で遷移しない。
 */
export function LineShareDialog({ href, onClose }: LineShareDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // 誤って送信しないよう、開いた直後の焦点は「やめる」に置く。
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const targets = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (targets.length === 0) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={onClose} />
      <div
        ref={dialogRef}
        className="dialog dialog--line-share"
        role="dialog"
        aria-modal="true"
        aria-labelledby="line-share-title"
        aria-describedby="line-share-body line-share-risk"
      >
        <h2 id="line-share-title" className="dialog__title">
          LINEを開きます
        </h2>
        <p id="line-share-body" className="dialog__body">
          送信はあなたの個人アカウントから行われます。送信先の選択と送信は、LINEの画面で行います。
        </p>
        <div id="line-share-risk" className="alert alert--warning dialog__warning">
          短時間に多くの相手へ同じ文面を送ると、LINEの利用規約によりアカウントが停止されることがあります。停止された場合、解除されるまで時間がかかることがあります。
        </div>
        <p className="dialog__note">
          本サービスは、LINEアカウントの停止について責任を負いません。送信したかどうかは、本サービスからは分かりません。
        </p>
        <div className="dialog__actions">
          <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--block">
            同意してLINEを開く
          </a>
          <button ref={cancelRef} type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            やめる
          </button>
        </div>
      </div>
    </div>
  );
}
