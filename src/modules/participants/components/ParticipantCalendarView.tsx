"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarMonthGrid, CalendarToolbar } from "@/components/common/CalendarMonth";
import {
  buildMonthGrid,
  currentMonth,
  defaultSelectedDate,
  entriesForDate,
  formatDayHeading,
  isMonthKey,
  shiftMonth,
  todayInTokyo,
} from "@/lib/calendar";
import { groupParticipantEntriesByDate, toParticipantCellItem } from "@/modules/participants/lib/calendar";
import { rsvpStatusTone } from "@/modules/events/lib/rsvp-status";
import type {
  ParticipantCalendarEntry,
  ParticipantCalendarResponse,
} from "@/modules/participants/types";
import { readProblem } from "@/lib/problem";
import { SITE } from "@/lib/site";
import { Alert, Badge, EmptyState, Loading, PageHeader, Row, Rows, Section, SectionHead } from "@/components/ui";

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
  const dayEntries = entriesForDate(grouped, selectedDate);
  const todayMonth = today.slice(0, 7);

  const goToMonth = (next: string) => {
    setMonth(next);
    setSelectedDate(defaultSelectedDate(next));
    router.replace(`/participant/calendar?month=${next}`, { scroll: false });
  };

  return (
    <div className="stack">
      <PageHeader
        eyebrow="参加者"
        title="参加カレンダー"
        lead="出欠を答えた催しを、開催日ごとに並べます。"
        actions={<><Link href="/participant" className="btn btn--outline btn--sm">
            参加者ホームへ
          </Link>
          <Link href="/participant/history" className="btn btn--ghost btn--sm">
            参加履歴
          </Link></>}
      />

      {error && (
        <Alert tone="warning">
          {error}{" "}
          <Link href={SITE.nav.participantLogin.href} className="text-link">
            {SITE.nav.participantLogin.label}
          </Link>
        </Alert>
      )}

      {loading && (
        <Loading>
          読み込んでいます
        </Loading>
      )}

      {!error && (
        <div className="cal">
          <CalendarToolbar
            month={month}
            todayMonth={todayMonth}
            onShift={(delta) => goToMonth(shiftMonth(month, delta))}
            onToday={() => goToMonth(todayMonth)}
          />
          <CalendarMonthGrid
            month={month}
            cells={cells}
            today={today}
            selectedDate={selectedDate}
            itemsForDate={(date) =>
              entriesForDate(grouped, date).map(toParticipantCellItem)
            }
            onSelect={setSelectedDate}
            legend={
              <>
                <span>
                  <i aria-hidden="true" />
                  出席
                </span>
                <span>
                  <i className="is-waitlist" aria-hidden="true" />
                  参加要望
                </span>
                <span>
                  <i className="is-declined" aria-hidden="true" />
                  欠席
                </span>
              </>
            }
          />
        </div>
      )}

      {!error && (
        <Section>
          <SectionHead
            title={<>{formatDayHeading(selectedDate)}</>}
            note={<>{dayEntries.length > 0
                ? `この日の催しは ${dayEntries.length}件です。`
                : "この日に出欠した催しはありません。"}</>}
          />
          {dayEntries.length === 0 ? (
            <EmptyState>
              <span className="empty__title">この日は空いています。</span>
              <span className="empty__body">日付を押すと、その日に出欠した催しが出ます。</span>
            </EmptyState>
          ) : (
            <Rows>
              {dayEntries.map((entry) => (
                <Row
                  title={<><Link href={`/events/${entry.event.id}`}>{entry.event.title}</Link></>}
                  meta={<>{entry.eventTime || "時刻未定"}
                      {entry.event.location ? ` ／ ${entry.event.location}` : ""}</>}
                  aside={<><Badge tone={rsvpStatusTone(entry.status)} small>
                    {entry.statusLabel}
                  </Badge></>}
                  key={entry.participantId}
                />
              ))}
            </Rows>
          )}
        </Section>
      )}
    </div>
  );
}
