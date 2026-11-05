"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarMonthGrid } from "@/components/common/CalendarMonth";
import {
  buildMonthGrid,
  countMonthEntries,
  defaultSelectedDate,
  entriesForDate,
  formatDayHeading,
  isMonthKey,
  shiftMonth,
  todayInTokyo,
} from "@/lib/calendar";
import { formatDateWithWeekdayJa } from "@/lib/format";
import { priceLabel } from "@/lib/serializers";
import { readProblem } from "@/lib/problem";
import {
  clampMonth,
  groupOrganizerEventsByDate,
  nextScheduleDate,
  sortOrganizerEvents,
  toOrganizerCellItem,
  upcomingSchedules,
} from "@/modules/organizers/lib/public-page";
import type { PublicOrganizerEvent, PublicOrganizerPage } from "@/modules/events/types";
import { Alert, Badge, EmptyState, Loading, Panel, Row, Rows, Section, SectionHead } from "@/components/ui";

type LoadState = "loading" | "ready" | "error";

interface OrganizerPageViewProps {
  userId: string;
}

/**
 * 主催者の公開ページのイベント部分（SCR-PUB-14）。
 *
 * プロフィールの下に、次の催し、カレンダー、一覧を縦に並べる。タブは持たない。
 * 誰でも読めるので、未ログイン用の骨組みは持たない。掲載条件は API と同じ
 * `sortOrganizerEvents` を通し、下書き・過去日・締め切った催しを画面でも落とす。
 *
 * 月だけを URL のクエリ（`month`）と連動させる。
 */
export function OrganizerPageView({ userId }: OrganizerPageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryMonth = searchParams.get("month");
  const today = useMemo(() => todayInTokyo(), []);
  const minMonth = today.slice(0, 7);

  const [month, setMonth] = useState(() => clampMonth(queryMonth, minMonth));
  const [selectedDate, setSelectedDate] = useState(() => defaultSelectedDate(clampMonth(queryMonth, minMonth)));
  const [data, setData] = useState<PublicOrganizerPage | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/public/organizers/${userId}/events`, { cache: "no-store" });
    if (res.status === 404) {
      setState("error");
      setError("主催者が見つかりません。");
      return;
    }
    if (!res.ok) {
      setState("error");
      setError(await readProblem(res));
      return;
    }
    setData((await res.json()) as PublicOrganizerPage);
    setState("ready");
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ブラウザの戻る・進むでクエリが変わったとき、表示中の月も合わせる。
  useEffect(() => {
    const next = clampMonth(queryMonth, minMonth);
    setMonth(next);
    if (!isMonthKey(queryMonth) || queryMonth === next) return;
    setSelectedDate((current) => (current.slice(0, 7) === next ? current : defaultSelectedDate(next)));
  }, [queryMonth, minMonth]);

  const events = useMemo(() => data?.events ?? [], [data]);
  // API は削除済みを返さない。掲載判定に要る `isDeleted` だけ足し、API と同じ関数へ通す。
  const listedEvents = useMemo(
    () => sortOrganizerEvents(events.map((event) => ({ ...event, isDeleted: false })), today),
    [events, today],
  );
  const nextEvent = listedEvents[0] ?? null;
  const nextDate = nextEvent ? nextScheduleDate(nextEvent, today) : null;
  const grouped = useMemo(() => groupOrganizerEventsByDate(listedEvents, today), [listedEvents, today]);
  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const monthEntryCount = useMemo(() => countMonthEntries(grouped, month), [grouped, month]);
  const dayEntries = entriesForDate(grouped, selectedDate);
  const todayMonth = today.slice(0, 7);
  const canGoPrev = month > minMonth;

  const goToMonth = (next: string) => {
    if (next < minMonth) return;
    setMonth(next);
    setSelectedDate(defaultSelectedDate(next));
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  if (state === "error") {
    return (
      <div className="stack">
        <Alert tone="error">{error}</Alert>
        <Link href="/events" className="btn btn--outline">
          イベントを探す
        </Link>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <Loading>
        読み込んでいます
      </Loading>
    );
  }

  if (listedEvents.length === 0) {
    return <EmptyState>これから開催されるイベントはありません。</EmptyState>;
  }

  return (
    <div className="stack">
      {nextEvent && (
        <Section className="section--tight">
          <SectionHead title="次の催し" />

          <Panel>
            <div className="stack">
              <div>
                <p className="panel__title">
                  <Link href={`/events/${nextEvent.id}`}>{nextEvent.title}</Link>
                </p>
                <p className="panel__note">
                  {nextDate ? formatDateWithWeekdayJa(nextDate) : "日付未定"}
                  {nextEvent.location ? ` ／ ${nextEvent.location}` : ""}
                </p>
              </div>
              <div className="btn-row">
                <SeatBadges event={nextEvent} />
                <Link href={`/events/${nextEvent.id}`} className="btn btn--primary">
                  {nextEvent.isFull ? "参加要望を出す" : "申込 /出欠回答"}
                </Link>
              </div>
            </div>
          </Panel>
        </Section>
      )}

      <Section>
        <SectionHead title="カレンダー" note="イベントの開催日を月ごとに確かめられます。" />

        <div className="cal">
          <div className="cal__head">
            <p className="cal__month" aria-live="polite">
              {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
            </p>
            <div className="cal__nav">
              <button
                type="button"
                aria-label="前の月"
                onClick={() => goToMonth(shiftMonth(month, -1))}
                disabled={!canGoPrev}
              >
                ‹
              </button>
              {month !== todayMonth && (
                <button type="button" onClick={() => goToMonth(todayMonth)}>
                  今月
                </button>
              )}
              <button
                type="button"
                aria-label="次の月"
                onClick={() => goToMonth(shiftMonth(month, 1))}
              >
                ›
              </button>
            </div>
          </div>

          <CalendarMonthGrid
            month={month}
            cells={cells}
            today={today}
            selectedDate={selectedDate}
            itemsForDate={(date) => entriesForDate(grouped, date).map(toOrganizerCellItem)}
            onSelect={setSelectedDate}
          />
        </div>

        {monthEntryCount === 0 && (
          <EmptyState>この月に開催されるイベントはありません。</EmptyState>
        )}

        <SectionHead
          title={<>{formatDayHeading(selectedDate)}</>}
          note={<>{dayEntries.length > 0
              ? `この日のイベントは ${dayEntries.length}件です。`
              : "この日に開催されるイベントはありません。"}</>}
        />
        {dayEntries.length === 0 ? (
          <EmptyState>日付を押すと、その日のイベントが出ます。</EmptyState>
        ) : (
          <Rows>
            {dayEntries.map((entry) => (
              <Row
                title={<><Link href={`/events/${entry.event.id}`}>{entry.event.title}</Link></>}
                meta={<>{entry.schedule.eventTime || "時刻未定"}
                    {entry.event.location ? ` ／ ${entry.event.location}` : ""}
                    {entry.event.isFull ? " ／ 参加要望受付中" : ""}</>}
                key={`${entry.event.id}:${entry.schedule.eventTime}`}
              />
            ))}
          </Rows>
        )}
      </Section>

      <Section>
        <SectionHead title="一覧" note={<>{listedEvents.length}件。満員のイベントは参加要望を受け付けます。
          </>} />
        <Rows>
          {listedEvents.map((event) => (
            <OrganizerPublicEventRow key={event.id} event={event} today={today} />
          ))}
        </Rows>
      </Section>
    </div>
  );
}

/** 残席の札。満員は参加要望の色にし、参加人数や名簿は出さない。 */
function SeatBadges({ event, small = false }: { event: PublicOrganizerEvent; small?: boolean }) {
  if (event.isFull && event.acceptsWaitlist) {
    return <Badge tone="waitlist" small={small}>参加要望受付中</Badge>;
  }
  if (event.isFull) {
    return <Badge tone="declined" small={small}>満員</Badge>;
  }
  if (event.remainingSeats !== null) {
    return <Badge tone="neutral" small={small}>残り {event.remainingSeats}名</Badge>;
  }
  return <Badge tone="neutral" small={small}>定員なし</Badge>;
}

function OrganizerPublicEventRow({ event, today }: { event: PublicOrganizerEvent; today: string }) {
  const dates = upcomingSchedules(event, today);
  const ratio =
    event.capacity !== null && event.capacity > 0
      ? Math.min(100, Math.round((event.attendingCount / event.capacity) * 100))
      : null;
  return (
    <Row
      title={<><Link href={`/events/${event.id}`}>{event.title}</Link></>}
      meta={<>{dates.map((row) => `${formatDateWithWeekdayJa(row.eventDate)} ${row.eventTime}`).join(" ／ ")}
          <br />
          {event.location} ／ {priceLabel(event.pricePlans)}
          <br />
          参加 {event.attendingCount}名
          {event.capacity !== null && ` / 定員 ${event.capacity}名`}</>}
      aside={<><span className="rows__value">{event.isFull ? "満員" : "受付中"}</span></>}
    >
      <div className="btn-row">
        <SeatBadges event={event} small />
        <Link href={`/events/${event.id}`} className="text-link">
          {event.isFull ? "参加要望を出す" : "申込 /出欠回答"}
        </Link>
      </div>
      {ratio !== null && (
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${ratio}%` }} />
        </div>
      )}
    </Row>
  );
}
