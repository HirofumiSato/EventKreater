"use client";

import { useState } from "react";
import { CalendarEventModal } from "@/components/common/CalendarEventModal";
import {
  WEEKDAY_LABELS,
  formatCellLabel,
  formatMonthTitle,
  splitCellItems,
  type CalendarCellItem,
  type MonthCell,
} from "@/lib/calendar";

function weekdayClass(index: number): string {
  if (index === 0) return "calendar__weekday calendar__weekday--sunday";
  if (index === 6) return "calendar__weekday calendar__weekday--saturday";
  return "calendar__weekday";
}

interface CalendarToolbarProps {
  month: string;
  todayMonth: string;
  onShift: (delta: number) => void;
  onToday: () => void;
}

/** 月の移動。主催者カレンダーと参加者カレンダーで同じ操作にする。 */
export function CalendarToolbar({ month, todayMonth, onShift, onToday }: CalendarToolbarProps) {
  return (
    <section className="panel calendar-toolbar">
      <div className="calendar-toolbar__nav">
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => onShift(-1)}
        >
          前月
        </button>
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => onShift(1)}
        >
          次月
        </button>
        {month !== todayMonth && (
          <button type="button" className="btn btn--sm" onClick={onToday}>
            今月
          </button>
        )}
      </div>
      <p className="calendar-toolbar__month" aria-live="polite">
        {formatMonthTitle(month)}
      </p>
    </section>
  );
}

interface CalendarMonthGridProps {
  month: string;
  cells: MonthCell[];
  today: string;
  selectedDate: string;
  /** その日の予定。月外の日は呼ばない。並び順は呼び出す側で決める。 */
  itemsForDate: (date: string) => CalendarCellItem[];
  onSelect: (date: string) => void;
}

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
}: CalendarMonthGridProps) {
  const [activeItem, setActiveItem] = useState<{ item: CalendarCellItem; date: string } | null>(null);

  const openItem = (item: CalendarCellItem, date: string) => {
    // モーダルの中身と下の一覧がずれないよう、開いた日の予定を選んでおく。
    onSelect(date);
    setActiveItem({ item, date });
  };

  return (
    <>
      <section className="card calendar" aria-label={`${formatMonthTitle(month)}のカレンダー`}>
        <div className="calendar__weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={label} className={weekdayClass(index)}>
              {label}
            </span>
          ))}
        </div>
        <div className="calendar__grid">
          {cells.map((cell) => {
            const items = cell.isOutside ? [] : itemsForDate(cell.date);
            const { visible, overflow } = splitCellItems(items);
            const classes = ["calendar__cell"];
            if (cell.isOutside) classes.push("is-outside");
            if (cell.date === today) classes.push("is-today");
            if (cell.date === selectedDate) classes.push("is-selected");
            return (
              <div
                key={cell.date}
                className={classes.join(" ")}
                aria-hidden={cell.isOutside || undefined}
              >
                {/* セル全体を押せる透明なボタン。短冊はこの上に重ねる。 */}
                <button
                  type="button"
                  className="calendar__cell-select"
                  aria-label={cell.isOutside ? undefined : formatCellLabel(cell.date, items.length)}
                  aria-pressed={cell.date === selectedDate}
                  disabled={cell.isOutside}
                  onClick={() => onSelect(cell.date)}
                />
                <span className="calendar__day">{Number(cell.date.slice(8, 10))}</span>
                {items.length > 0 && (
                  <span className="calendar__events">
                    {visible.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`calendar__event${
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
                        className="calendar__more"
                        aria-label={`${formatCellLabel(cell.date, items.length)}。すべて見る`}
                        onClick={() => onSelect(cell.date)}
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
      </section>
      <CalendarEventModal
        item={activeItem?.item ?? null}
        date={activeItem?.date ?? selectedDate}
        onClose={() => setActiveItem(null)}
      />
    </>
  );
}
