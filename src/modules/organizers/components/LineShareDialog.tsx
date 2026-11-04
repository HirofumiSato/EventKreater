"use client";

import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui";

interface LineShareDialogProps {
  /** 押した時点で本文から組み立てた LINE の共有 URL。 */
  href: string;
  onClose: () => void;
  /** 何を送るかの題。紹介リンクか告知リンクかを、呼び出し側が決める。 */
  title?: string;
  /** 警告の下に置く、LINE 側の操作の説明。リンクの呼び方が変わるので呼び出し側が渡す。 */
  hint?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled])';

/**
 * LINE を開く前の注意書き。
 * 送信は利用者の個人アカウントから行われ、停止されうることを、送る直前に読ませる。
 * 同意した場合だけ中のリンクを踏ませ、アプリからは自動で遷移しない。
 */
export function LineShareDialog({
  href,
  onClose,
  title = "LINEを開きます",
  hint = "LINE画面で「共有」を押すと、リンクが送られます。確認モーダルは出ません。",
}: LineShareDialogProps) {
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
        aria-describedby="line-share-body line-share-risk line-share-hint"
      >
        <h2 id="line-share-title" className="dialog__title">
          {title}
        </h2>
        <p id="line-share-body" className="dialog__body">
          送信はあなたの個人アカウントから行われます。送信先の選択と送信は、LINEの画面で行います。
        </p>
        <Alert tone="warning" as="div" id="line-share-risk" className="dialog__warning">
          <span className="dialog__warning-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3 2.5 20h19L12 3Z" />
              <path d="M12 9.5v4.5" />
              <path d="M12 17.2h.01" />
            </svg>
          </span>
          <span>
            短時間に多くの相手へ同じ文面を送ると、LINEの利用規約により
            <strong className="dialog__warning-strong">アカウントがロック</strong>
            されることがあります。ロックされた場合、解除されるまで時間がかかることがあります。
          </span>
        </Alert>
        <div id="line-share-hint" className="notice dialog__hint">
          {hint}
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
