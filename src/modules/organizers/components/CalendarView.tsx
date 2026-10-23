"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarMonthGrid, CalendarToolbar } from "@/components/common/CalendarMonth";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { LineShareButton } from "@/modules/organizers/components/LineShareButton";
import { STATUS_LABELS, type OrganizerEvent } from "@/modules/events/types";
import {
  buildMonthGrid,
  countMonthEntries,
  currentMonth,
  defaultSelectedDate,
  entriesForDate,
  formatDayHeading,
  groupSchedulesByDate,
  isMonthKey,
  organizerEventHref,
  shiftMonth,
  toOrganizerCellItem,
  todayInTokyo,
} from "@/modules/organizers/lib/calendar";
import { readProblem } from "@/lib/problem";
import { SITE } from "@/lib/site";

export function CalendarView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryMonth = searchParams.get("month");

  const [month, setMonth] = useState(() => (isMonthKey(queryMonth) ? queryMonth : currentMonth()));
  const [selectedDate, setSelectedDate] = useState(() => defaultSelectedDate(month));
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
      current.slice(0, 7) === queryMonth ? current : defaultSelectedDate(queryMonth),
    );
  }, [queryMonth, month]);

  const grouped = useMemo(() => groupSchedulesByDate(events), [events]);
  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const monthEntryCount = useMemo(() => countMonthEntries(grouped, month), [grouped, month]);
  const dayEntries = entriesForDate(grouped, selectedDate);
  const todayMonth = today.slice(0, 7);

  const goToMonth = (next: string) => {
    setMonth(next);
    setSelectedDate(defaultSelectedDate(next));
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
          <Link href={SITE.nav.createEvent.href} className="btn btn--primary">
            新規作成
          </Link>
        </div>
      </section>

      <CalendarToolbar
        month={month}
        todayMonth={todayMonth}
        onShift={(delta) => goToMonth(shiftMonth(month, delta))}
        onToday={() => goToMonth(todayMonth)}
      />

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
          <Link href={SITE.nav.createEvent.href} className="btn btn--outline btn--sm">
            新規作成
          </Link>
        </section>
      )}

      {!error && (
        <div className="calendar-layout">
          <CalendarMonthGrid
            month={month}
            cells={cells}
            today={today}
            selectedDate={selectedDate}
            itemsForDate={(date) =>
              entriesForDate(grouped, date).map(toOrganizerCellItem)
            }
            onSelect={setSelectedDate}
          />

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
                    <div className="calendar-day__row">
                      <Link
                        href={organizerEventHref(event)}
                        className="calendar-day__link"
                      >
                        <span className="calendar-day__time">{schedule.eventTime || "時刻未定"}</span>
                        <span className="calendar-day__title">{event.title}</span>
                        <span className="calendar-day__meta">
                          {STATUS_LABELS[event.status]}
                          {event.role === "CO_HOST" && " · 共同主催"}
                        </span>
                      </Link>
                      {/* 下書きと受付停止は公開ページを配る意味が無いので出さない。 */}
                      {event.status === "PUBLISHED" && (
                        <LineShareButton
                          title={event.title}
                          schedules={event.schedules}
                          location={event.location}
                          path={`/events/${event.id}`}
                          className="btn btn--outline btn--sm"
                        />
                      )}
                    </div>
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
