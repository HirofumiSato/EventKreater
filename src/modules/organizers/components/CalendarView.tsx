"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarMonthGrid, CalendarToolbar, type CalendarSelectReason } from "@/components/common/CalendarMonth";
import { LineShareButton } from "@/modules/organizers/components/LineShareButton";
import { STATUS_LABELS, type OrganizerEvent } from "@/modules/events/types";
import {
  buildMonthGrid,
  countMonthEntries,
  currentMonth,
  defaultSelectedDate,
  entriesForDate,
  entriesForMonth,
  formatDayHeading,
  formatMonthTitle,
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

/** 一覧の日付ごとのまとまりの id。カレンダーのセルからここへ寄せる。 */
function dayAnchorId(date: string): string {
  return `cal-day-${date}`;
}

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
      setError("ログインするか、幹事用の端末で開いてください。");
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
  const monthDays = useMemo(() => entriesForMonth(grouped, month), [grouped, month]);
  const todayMonth = today.slice(0, 7);

  const goToMonth = (next: string) => {
    setMonth(next);
    setSelectedDate(defaultSelectedDate(next));
    router.replace(`/organizer/calendar?month=${next}`, { scroll: false });
  };

  /**
   * 日付を選ぶ。下の一覧は今月ぶんをまとめて出すので、押した日のまとまりへ寄せる。
   * 短冊（`item`）は詳細のモーダルを開くだけなので、画面を動かさない。
   */
  const selectDate = (date: string, reason: CalendarSelectReason) => {
    setSelectedDate(date);
    if (reason === "item") return;
    const target = document.getElementById(dayAnchorId(date));
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  };

  return (
    <div className="stack">
      <PageHeader title="カレンダー" />

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
            別の月へ移るか、新しいイベントを作ってください。{" "}
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
            onSelect={selectDate}
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

      {/* 月に 1 件も無いときは、上の空状態だけを出す（同じ文言を 2 度並べない）。 */}
      {!error && monthDays.length > 0 && (
        <Section>
          <SectionHead
            title={<>{formatMonthTitle(month)}のイベント</>}
            note={`この月のイベントは ${monthEntryCount}件です。`}
          />
          <div className="cal-month">
            {monthDays.map((day) => (
              <div
                key={day.date}
                id={dayAnchorId(day.date)}
                className={`cal-month__day${day.date === selectedDate ? " is-selected" : ""}`}
              >
                <h3 className="cal-month__date">{formatDayHeading(day.date)}</h3>
                <Rows>
                  {day.entries.map(({ event, schedule }) => (
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
                          出欠
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
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
