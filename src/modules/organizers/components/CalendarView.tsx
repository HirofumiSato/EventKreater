"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarMonthGrid, CalendarToolbar } from "@/components/common/CalendarMonth";
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
import { Alert, EmptyState, Loading, PageHeader, Row, Rows, Section, SectionHead } from "@/components/ui";

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
      <PageHeader eyebrow="主催者" title="カレンダー" lead="開催日ごとに並びます。日付を押すと、その日の催しが出ます。" />

      {error && (
        <Alert tone="warning">
          {error}{" "}
          <Link href={SITE.nav.organizerLogin.href} className="text-link">
            {SITE.nav.organizerLogin.label}
          </Link>
        </Alert>
      )}

      {loading && (
        <Loading>
          読み込んでいます
        </Loading>
      )}

      {!error && !loading && monthEntryCount === 0 && (
        <EmptyState as="div">
          <p className="empty__title">この月に予定はありません。</p>
          <p className="empty__body">
            別の月へ移るか、新しい催しを作ってください。{" "}
            <Link href={SITE.nav.createEvent.href} className="text-link">
              新規作成
            </Link>
          </p>
        </EmptyState>
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
              entriesForDate(grouped, date).map(toOrganizerCellItem)
            }
            onSelect={setSelectedDate}
            legend={
              <>
                <span>
                  <i aria-hidden="true" />
                  公開中
                </span>
                <span>
                  <i className="is-muted" aria-hidden="true" />
                  下書き・受付停止
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
                : "この日の予定はありません。"}</>}
          />
          {dayEntries.length === 0 ? (
            <EmptyState>
              <span className="empty__title">この日は空いています。</span>
              <span className="empty__body">日付を押すと、その日の催しが出ます。</span>
            </EmptyState>
          ) : (
            <Rows>
              {dayEntries.map(({ event, schedule }) => (
                <Row
                  title={<><Link href={organizerEventHref(event)}>{event.title}</Link></>}
                  meta={<>{schedule.eventTime || "時刻未定"}
                      {event.location ? ` ／ ${event.location}` : ""}
                      <br />
                      参加 {event.stats.attendingCount}
                      {event.capacity === null ? "名（定員なし）" : ` / ${event.capacity}名`} ・{" "}
                      {STATUS_LABELS[event.status]}
                      {event.role === "CO_HOST" && " · 共同主催"}</>}
                  aside={<><div className="event-card__actions">
                    <Link href={`/organizer/events/${event.id}/participants`} className="btn btn--ghost btn--sm">
                      名簿
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
                  </div></>}
                  key={`${event.id}-${schedule.id}`}
                />
              ))}
            </Rows>
          )}
        </Section>
      )}
    </div>
  );
}
