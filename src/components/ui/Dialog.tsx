import type { ReactNode } from "react";
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
};

/**
 * 重ねて出す 1 枚。`.modal`（背景）と `.dialog`（紙）の骨格を持つ。
 *
 * 閉じる道は、右上の `dialog__close` と背景の `<button>` の 2 つ。どちらも `onClose` を
 * 呼ぶだけなので、閉じたあとの状態は画面側の 1 箇所で決める。`actions` の中の
 * 閉じるボタンも同じ `onClose` に繋ぐと、押した場所で動きが変わらない。
 *
 * 背景の `<button>` と閉じる印は装飾だが押せるので、読み上げ名を必ず付ける。
 * 本文の段落（`dialog__body`）は画面ごとに違うので children で渡す。
 */
export function Dialog({ title, titleId, onClose, closeLabel = "閉じる", actions, children }: DialogProps) {
  return (
    <div className="modal" style={{ display: "flex" }}>
      {onClose ? (
        <button type="button" className="modal__backdrop" aria-label={closeLabel} onClick={onClose} />
      ) : null}
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
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
