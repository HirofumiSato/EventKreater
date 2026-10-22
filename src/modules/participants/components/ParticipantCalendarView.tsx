"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarMonthGrid, CalendarToolbar } from "@/components/common/CalendarMonth";
import {
  buildMonthGrid,
  countMonthEntries,
  currentMonth,
  defaultSelectedDate,
  entriesForDate,
  formatDayHeading,
  isMonthKey,
  shiftMonth,
  todayInTokyo,
} from "@/lib/calendar";
import { groupParticipantEntriesByDate, toParticipantCellItem } from "@/modules/participants/lib/calendar";
import type {
  ParticipantCalendarEntry,
  ParticipantCalendarResponse,
} from "@/modules/participants/types";
import { readProblem } from "@/lib/problem";
import { SITE } from "@/lib/site";

/** 出欠で選んだ日程の日付に、出席・欠席の両方を置く参加者カレンダー。 */
export function ParticipantCalendarView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryMonth = searchParams.get("month");

  const [month, setMonth] = useState(() => (isMonthKey(queryMonth) ? queryMonth : currentMonth()));
  const [selectedDate, setSelectedDate] = useState(() => defaultSelectedDate(month));
  const [entries, setEntries] = useState<ParticipantCalendarEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => todayInTokyo(), []);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/user/calendar", { cache: "no-store" });
    if (res.status === 401) {
      setError("ログインが必要です。出欠の履歴を残すには、参加者としてログインしてください。");
      setEntries([]);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      setEntries([]);
      return;
    }
    const data = (await res.json()) as ParticipantCalendarResponse;
    setEntries(data.items);
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

  const grouped = useMemo(() => groupParticipantEntriesByDate(entries), [entries]);
  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const monthEntryCount = useMemo(() => countMonthEntries(grouped, month), [grouped, month]);
  const dayEntries = entriesForDate(grouped, selectedDate);
  const todayMonth = today.slice(0, 7);

  const goToMonth = (next: string) => {
    setMonth(next);
    setSelectedDate(defaultSelectedDate(next));
    router.replace(`/participant/calendar?month=${next}`, { scroll: false });
  };

  return (
    <div className="stack">
      <section className="panel">
        <div>
          <h1 className="page-title">参加カレンダー</h1>
          <p className="page-lead">出欠を答えた催しを、開催日ごとに並べます。</p>
        </div>
        <div className="panel__actions">
          <Link href="/participant" className="btn btn--outline">
            参加者ホームへ
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
          <Link href={SITE.nav.participantLogin.href} className="text-link">
            {SITE.nav.participantLogin.label}
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
          <p>この月に出欠した催しはありません。</p>
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
              entriesForDate(grouped, date).map(toParticipantCellItem)
            }
            onSelect={setSelectedDate}
          />

          <section className="card calendar-day" aria-labelledby="participant-calendar-day-heading">
            <div className="calendar-day__head">
              <h2 id="participant-calendar-day-heading" className="card__title">
                {formatDayHeading(selectedDate)}
              </h2>
              <p className="help">{dayEntries.length > 0 ? `${dayEntries.length}件` : ""}</p>
            </div>
            {dayEntries.length === 0 ? (
              <p className="empty">この日に出欠した催しはありません。</p>
            ) : (
              <ul className="calendar-day__list">
                {dayEntries.map((entry) => {
                  const declined = entry.status === "DECLINED";
                  return (
                    <li
                      key={entry.participantId}
                      className={`calendar-day__item${declined ? " is-declined" : ""}`}
                    >
                      <Link href={`/events/${entry.event.id}`} className="calendar-day__link">
                        <span className="calendar-day__time">
                          {entry.eventTime || "時刻未定"}
                        </span>
                        <span className="calendar-day__title">{entry.event.title}</span>
                        <span
                          className={`calendar-day__meta${declined ? " calendar-day__meta--declined" : ""}`}
                        >
                          {entry.statusLabel}
                          {entry.event.location ? ` · ${entry.event.location}` : ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
