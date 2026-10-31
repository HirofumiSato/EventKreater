"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatDayHeading, type CalendarCellItem } from "@/lib/calendar";

interface CalendarEventModalProps {
  /** 開く予定。`null` のときは何も出さない。 */
  item: CalendarCellItem | null;
  /** 予定の日付。見出しに使う。 */
  date: string;
  onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled])';

/**
 * セルの短冊をタップしたときのモーダル。
 * セルでは切れているイベント名を全文で出し、イベントページへ進めるようにする。
 */
export function CalendarEventModal({ item, date, onClose }: CalendarEventModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = item !== null;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // 開いた直後は「閉じる」に置く。リンクへ誤って飛ばないようにする。
    closeRef.current?.focus();

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
  }, [open, onClose]);

  if (!item) return null;

  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={onClose} />
      <div
        ref={dialogRef}
        className="dialog dialog--calendar-event"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-modal-title"
      >
        <p className="eyebrow">{formatDayHeading(date)}</p>
        <h2 id="calendar-event-modal-title" className="dialog__title">
          {item.title}
        </h2>
        {item.detail && <p className="dialog__body">{item.detail}</p>}
        <div className="dialog__actions">
          {item.href && (
            <Link href={item.href} className="btn btn--primary btn--block">
              イベント告知ページへ
            </Link>
          )}
          <button ref={closeRef} type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
