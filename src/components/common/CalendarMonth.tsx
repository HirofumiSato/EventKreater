"use client";

import { useState, type ReactNode } from "react";
import { CalendarEventModal } from "@/components/common/CalendarEventModal";
import {
  WEEKDAY_LABELS,
  formatCellLabel,
  formatMonthTitle,
  splitCellItems,
  type CalendarCellItem,
  type MonthCell,
} from "@/lib/calendar";

interface CalendarToolbarProps {
  month: string;
  todayMonth: string;
  onShift: (delta: number) => void;
  onToday: () => void;
}

/** 月の移動。主催者カレンダーと参加者カレンダーで同じ操作にする。 */
export function CalendarToolbar({ month, todayMonth, onShift, onToday }: CalendarToolbarProps) {
  return (
    <div className="cal__head">
      <p className="cal__month" aria-live="polite">
        {formatMonthTitle(month)}
      </p>
      <div className="cal__nav">
        <button type="button" aria-label="前の月" onClick={() => onShift(-1)}>
          ‹
        </button>
        {month !== todayMonth ? (
          <button type="button" onClick={onToday}>
            今月
          </button>
        ) : null}
        <button type="button" aria-label="次の月" onClick={() => onShift(1)}>
          ›
        </button>
      </div>
    </div>
  );
}

interface CalendarMonthGridProps {
  month: string;
  cells: MonthCell[];
  today: string;
  selectedDate: string;
  /** その日の予定。月外の日は呼ばない。並び順は呼び出す側で決める。 */
  itemsForDate: (date: string) => CalendarCellItem[];
  /**
   * 日付を選んだ。`reason` は押した場所。
   * セルと `+N` は「その日の一覧を見たい」、短冊は「詳細を開きたい」ので、
   * 下に一覧を持つ画面は `reason` で動きを変えられる。
   */
  onSelect: (date: string, reason: CalendarSelectReason) => void;
  /** 月の下に出す凡例。色の意味は画面ごとに違うので、呼び出す側が決める。 */
  legend?: ReactNode;
}

/** 日付を選んだ場所。`item` は短冊（モーダルを開く）、それ以外はセルか `+N`。 */
export type CalendarSelectReason = "cell" | "item" | "more";

/**
 * 日曜始まりの月グリッド。
 * セルには日番号と、催し名の短冊を最大3件まで出す（入りきらない分は「+N」）。
 * 短冊を押すと、切れている催し名を全文で見られるモーダルを開く。
 */
export function CalendarMonthGrid({
  month,
  cells,
  today,
  selectedDate,
  itemsForDate,
  onSelect,
  legend,
}: CalendarMonthGridProps) {
  const [activeItem, setActiveItem] = useState<{ item: CalendarCellItem; date: string } | null>(null);

  const openItem = (item: CalendarCellItem, date: string) => {
    // モーダルの中身と下の一覧がずれないよう、開いた日の予定を選んでおく。
    onSelect(date, "item");
    setActiveItem({ item, date });
  };

  return (
    <>
      <div className="cal__weekday" aria-hidden="true">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={label} className={index === 0 ? "is-sunday" : undefined}>
            {label}
          </span>
        ))}
      </div>
      <div className="cal__grid" role="group" aria-label={`${formatMonthTitle(month)}のカレンダー`}>
        {cells.map((cell) => {
          const items = cell.isOutside ? [] : itemsForDate(cell.date);
          const { visible, overflow } = splitCellItems(items);
          const classes = ["cal__day"];
          if (cell.isOutside) classes.push("is-outside");
          if (cell.date === today) classes.push("is-today");
          if (cell.date === selectedDate) classes.push("is-selected");
          if (items.length > 0) classes.push("has-event");
          return (
            <div key={cell.date} className={classes.join(" ")} aria-hidden={cell.isOutside || undefined}>
              {/* セル全体を押せる透明なボタン。短冊はこの上に重ねる。 */}
              <button
                type="button"
                className="cal__select"
                aria-label={cell.isOutside ? undefined : formatCellLabel(cell.date, items.length)}
                aria-pressed={cell.date === selectedDate}
                disabled={cell.isOutside}
                onClick={() => onSelect(cell.date, "cell")}
              />
              <span className="cal__day-number">{Number(cell.date.slice(8, 10))}</span>
              {items.length > 0 && (
                <span className="cal__events">
                  {visible.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`cal__event${
                        item.tone === "muted" ? " is-muted" : item.tone === "waitlist" ? " is-waitlist" : ""
                      }`}
                      title={item.title}
                      aria-haspopup="dialog"
                      onClick={() => openItem(item, cell.date)}
                    >
                      {item.title}
                    </button>
                  ))}
                  {overflow > 0 && (
                    <button
                      type="button"
                      className="cal__more"
                      aria-label={`${formatCellLabel(cell.date, items.length)}。すべて見る`}
                      onClick={() => onSelect(cell.date, "more")}
                    >
                      +{overflow}
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {legend ? <div className="cal__legend">{legend}</div> : null}
      <CalendarEventModal
        item={activeItem?.item ?? null}
        date={activeItem?.date ?? selectedDate}
        onClose={() => setActiveItem(null)}
      />
    </>
  );
}
