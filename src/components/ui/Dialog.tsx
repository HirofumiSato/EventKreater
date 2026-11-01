"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type DialogProps = {
  /** `dialog__title` に出す題。 */
  title: ReactNode;
  /** `aria-labelledby` と `h3` の id に使う。同じ画面に複数出すときは必須。 */
  titleId?: string;
  /** 閉じるときの動き。省略すると、背景と右上の閉じる印を出さない。 */
  onClose?: () => void;
  /** 背景と閉じる印の読み上げ名。既定は「閉じる」。 */
  closeLabel?: string;
  /** `dialog__actions` に置くボタン。 */
  actions?: ReactNode;
  /** 題と操作の間に置く本文。 */
  children?: ReactNode;
  /**
   * 出すかどうか。既定は `true`。
   *
   * 告知ページの出欠のように、閉じている間も中身（入力中の値）を残したい画面は
   * `open` を渡して `hidden` で切り替える。`false` のときは描画されないのではなく、
   * `hidden` で隠れるだけなので、開き直してもフォームの状態は消えない。
   */
  open?: boolean;
  /**
   * 出し方。`center` は画面の中央、`sheet` は画面の下から出る 1 枚。
   * `sheet` は本文だけを送り、題と操作は常に見える位置に残す。
   */
  variant?: "center" | "sheet";
  /**
   * 端末の戻る（`popstate`）で閉じるか。既定は `false`。
   *
   * 履歴を 1 つ積んでから開き、閉じたときにその 1 つを戻す。重ねて開く画面で
   * 有効にすると、戻る 1 回で 1 枚だけ閉じる。常用するのは告知ページの出欠だけ。
   */
  dismissOnBack?: boolean;
};

/** 焦点を移してよい要素。Tab の循環と、閉じたあとの戻り先に使う。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * 本文を止める札の数。重ねて開いたときに、先に閉じた 1 枚が解除しないようにする。
 * モジュールに 1 つ置き、`<html>` の属性だけを切り替える。
 */
let scrollLocks = 0;

function lockScroll() {
  scrollLocks += 1;
  document.documentElement.dataset.scrollLock = "true";
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) delete document.documentElement.dataset.scrollLock;
}

/**
 * 重ねて出す 1 枚。`.modal`（背景）と `.dialog`（紙）の骨格を持つ。
 *
 * 閉じる道は、右上の `dialog__close`・背景の `<button>`・端末の戻る（`dismissOnBack`）・
 * Escape の 4 つ。どれも `onClose` を呼ぶだけなので、閉じたあとの状態は画面側の 1 箇所で決める。
 * `actions` の中の閉じるボタンも同じ `onClose` に繋ぐと、押した場所で動きが変わらない。
 *
 * 開いている間は、焦点を紙の中へ入れ、Tab を紙の中で循環させ、閉じたら元の要素へ戻す。
 * 本文は `data-scroll-lock` で止める（紙の後ろが動くと、層に乗っている感覚が切れる）。
 *
 * 背景の `<button>` と閉じる印は装飾だが押せるので、読み上げ名を必ず付ける。
 * 本文の段落（`dialog__body`）は画面ごとに違うので children で渡す。
 */
export function Dialog({
  title,
  titleId,
  onClose,
  closeLabel = "閉じる",
  actions,
  children,
  open = true,
  variant = "center",
  dismissOnBack = false,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** `onClose` は毎回作り直されることが多い。effect を張り直さないよう、ref 経由で呼ぶ。 */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 焦点・Escape・本文の停止。開いている間だけ張る。
  // `onClose` は毎回作り直されるので依存に入れない（入れると 1 描画ごとに焦点が飛ぶ）。
  useEffect(() => {
    if (!open || !closeRef.current) return;
    const panel = panelRef.current;
    const restore = document.activeElement as HTMLElement | null;

    lockScroll();
    panel?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockScroll();
      // 開く前に触っていた要素へ戻す。消えていれば何もしない。
      if (restore && restore.isConnected) restore.focus();
    };
  }, [open]);

  // 端末の戻るで閉じる。開いたときに 1 つ積み、画面側の操作で閉じたときは自分で戻す。
  useEffect(() => {
    if (!open || !dismissOnBack || !closeRef.current) return;
    let closedByPop = false;
    const onPop = () => {
      closedByPop = true;
      closeRef.current?.();
    };
    window.history.pushState({ ...window.history.state, dialog: true }, "");
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // 自分で戻す前に listener を外してあるので、この戻りで二重に閉じることはない。
      if (!closedByPop && window.history.state?.dialog) window.history.back();
    };
  }, [open, dismissOnBack]);

  return (
    <div className={`modal modal--${variant}${open ? " modal--open" : ""}`} hidden={!open}>
      {onClose ? (
        <button type="button" className="modal__backdrop" aria-label={closeLabel} onClick={onClose} />
      ) : null}
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {onClose ? (
          <button type="button" className="dialog__close" aria-label={closeLabel} onClick={onClose}>
            <X className="icon" aria-hidden="true" />
          </button>
        ) : null}
        <h3 id={titleId} className="dialog__title">
          {title}
        </h3>
        {children}
        {actions ? <div className="dialog__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
