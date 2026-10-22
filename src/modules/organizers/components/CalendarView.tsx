"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { STATUS_LABELS, type OrganizerEvent } from "@/modules/events/types";
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  countMonthEntries,
  currentMonth,
  entriesForDate,
  formatCellLabel,
  formatDayHeading,
  groupSchedulesByDate,
  isMonthKey,
  shiftMonth,
  todayInTokyo,
} from "@/modules/organizers/lib/calendar";
import { readProblem } from "@/lib/problem";
import { SITE } from "@/lib/site";

function weekdayClass(index: number): string {
  if (index === 0) return "calendar__weekday calendar__weekday--sunday";
  if (index === 6) return "calendar__weekday calendar__weekday--saturday";
  return "calendar__weekday";
}

/** 月の選択を変えたとき、今日がその月なら今日を、そうでなければ1日を選ぶ。 */
function defaultSelection(month: string): string {
  const today = todayInTokyo();
  return today.slice(0, 7) === month ? today : `${month}-01`;
}

function monthTitle(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
}

export function CalendarView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryMonth = searchParams.get("month");

  const [month, setMonth] = useState(() => (isMonthKey(queryMonth) ? queryMonth : currentMonth()));
  const [selectedDate, setSelectedDate] = useState(() => defaultSelection(month));
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => todayInTokyo(), []);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/organizer/events", { cache: "no-store" });
    if (res.status === 401) {
      setError("ログインするか、幹事トークン付きの端末で開いてください。");
      setEvents([]);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      setEvents([]);
      return;
    }
    const data = (await res.json()) as { events: OrganizerEvent[] };
    setEvents(data.events);
    setError(null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  // ブラウザの戻る・進むでクエリが変わったとき、表示中の月も合わせる。
  useEffect(() => {
    if (!isMonthKey(queryMonth) || queryMonth === month) return;
    setMonth(queryMonth);
    setSelectedDate((current) =>
      current.slice(0, 7) === queryMonth ? current : defaultSelection(queryMonth),
    );
  }, [queryMonth, month]);

  const grouped = useMemo(() => groupSchedulesByDate(events), [events]);
  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const monthEntryCount = useMemo(() => countMonthEntries(grouped, month), [grouped, month]);
  const dayEntries = entriesForDate(grouped, selectedDate);
  const todayMonth = today.slice(0, 7);

  const goToMonth = (next: string) => {
    setMonth(next);
    setSelectedDate(defaultSelection(next));
    router.replace(`/organizer/calendar?month=${next}`, { scroll: false });
  };

  return (
    <div className="stack">
      <OrganizerTabs />

      <section className="panel">
        <div>
          <h1 className="page-title">カレンダー</h1>
          <p className="page-lead">自分の催しを、開催日ごとに並べます。</p>
        </div>
        <div className="panel__actions">
          <Link href="/organizer/events" className="btn btn--outline">
            主催一覧へ
          </Link>
          <Link href="/organizer/events/new" className="btn btn--primary">
            新規作成
          </Link>
        </div>
      </section>

      <section className="panel calendar-toolbar">
        <div className="calendar-toolbar__nav">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => goToMonth(shiftMonth(month, -1))}>
            前月
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => goToMonth(shiftMonth(month, 1))}>
            次月
          </button>
          {month !== todayMonth && (
            <button type="button" className="btn btn--sm" onClick={() => goToMonth(todayMonth)}>
              今月
            </button>
          )}
        </div>
        <p className="calendar-toolbar__month" aria-live="polite">
          {monthTitle(month)}
        </p>
      </section>

      {error && (
        <p className="alert alert--warning">
          {error}{" "}
          <Link href={SITE.nav.organizerLogin.href} className="text-link">
            {SITE.nav.organizerLogin.label}
          </Link>
        </p>
      )}

      {loading && (
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      )}

      {!error && !loading && monthEntryCount === 0 && (
        <section className="card calendar-empty">
          <p>この月に予定はありません。</p>
          <Link href="/organizer/events/new" className="btn btn--outline btn--sm">
            新規作成
          </Link>
        </section>
      )}

      {!error && (
        <div className="calendar-layout">
          <section className="card calendar" aria-label={`${monthTitle(month)}のカレンダー`}>
            <div className="calendar__weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={label} className={weekdayClass(index)}>
                  {label}
                </span>
              ))}
            </div>
            <div className="calendar__grid">
              {cells.map((cell) => {
                const count = cell.isOutside ? 0 : entriesForDate(grouped, cell.date).length;
                const classes = ["calendar__cell"];
                if (cell.isOutside) classes.push("is-outside");
                if (cell.date === today) classes.push("is-today");
                if (cell.date === selectedDate) classes.push("is-selected");
                return (
                  <button
                    key={cell.date}
                    type="button"
                    className={classes.join(" ")}
                    aria-label={cell.isOutside ? undefined : formatCellLabel(cell.date, count)}
                    aria-hidden={cell.isOutside || undefined}
                    aria-pressed={cell.date === selectedDate}
                    disabled={cell.isOutside}
                    onClick={() => setSelectedDate(cell.date)}
                  >
                    <span className="calendar__day">{Number(cell.date.slice(8, 10))}</span>
                    {count > 0 && (
                      <span className="calendar__dots" aria-hidden="true">
                        {Array.from({ length: Math.min(3, count) }, (_, index) => (
                          <span key={index} className="calendar__dot" />
                        ))}
                        {count > 3 && <span className="calendar__dot-more">+{count - 3}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card calendar-day" aria-labelledby="calendar-day-heading">
            <div className="calendar-day__head">
              <h2 id="calendar-day-heading" className="card__title">
                {formatDayHeading(selectedDate)}
              </h2>
              <p className="help">{dayEntries.length > 0 ? `${dayEntries.length}件` : ""}</p>
            </div>
            {dayEntries.length === 0 ? (
              <p className="empty">この日の予定はありません。</p>
            ) : (
              <ul className="calendar-day__list">
                {dayEntries.map(({ event, schedule }) => (
                  <li key={`${event.id}-${schedule.id}`} className="calendar-day__item">
                    <Link
                      href={
                        event.status === "DRAFT"
                          ? `/organizer/events/${event.id}/edit`
                          : `/organizer/events/${event.id}/participants`
                      }
                      className="calendar-day__link"
                    >
                      <span className="calendar-day__time">{schedule.eventTime || "時刻未定"}</span>
                      <span className="calendar-day__title">{event.title}</span>
                      <span className="calendar-day__meta">
                        {STATUS_LABELS[event.status]}
                        {event.role === "CO_HOST" && " · 共同主催"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
