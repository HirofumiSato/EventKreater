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
import { priceLabel } from "@/lib/serializers";
import { readProblem } from "@/lib/problem";
import { SITE } from "@/lib/site";
import {
  clampMonth,
  groupOrganizerEventsByDate,
  organizerProfilePath,
  toOrganizerCellItem,
  upcomingSchedules,
} from "@/modules/organizers/lib/public-page";
import type { PublicOrganizerEvent, PublicOrganizerPage } from "@/modules/events/types";
import { Alert, EmptyState, Loading, Row, Rows, Section, SectionHead } from "@/components/ui";

type LoadState = "loading" | "ready" | "login" | "error";

interface OrganizerPageViewProps {
  userId: string;
  /**
   * プレビューでは、主催者本人が見ている前提で中身だけを出す。
   * 未ログインのぼかし表示はプレビューに含めない。
   */
  preview?: boolean;
}

/**
 * 主催者の公開ページの催し部分（SCR-PUB-14）。
 *
 * プロフィールの下に、カレンダーと一覧を縦に並べる。タブは持たない。
 * 未ログインではAPIが 403 を返すので、中身は描かずに骨組みをぼかして案内を重ねる。
 * サーバー側でも催しを返さないため、DOM を見ても内容は分からない。
 *
 * 月だけを URL のクエリ（`month`）と連動させる。
 */
export function OrganizerPageView({ userId, preview = false }: OrganizerPageViewProps) {
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
    if (res.status === 403) {
      setState("login");
      setData(null);
      return;
    }
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
  const grouped = useMemo(() => groupOrganizerEventsByDate(events, today), [events, today]);
  const cells = useMemo(() => buildMonthGrid(month), [month]);
  const monthEntryCount = useMemo(() => countMonthEntries(grouped, month), [grouped, month]);
  const dayEntries = entriesForDate(grouped, selectedDate);
  const todayMonth = today.slice(0, 7);
  const canGoPrev = month > minMonth;

  const goToMonth = (next: string) => {
    if (next < minMonth) return;
    setMonth(next);
    setSelectedDate(defaultSelectedDate(next));
    if (preview) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  if (state === "login") {
    return <LockedSkeleton nextPath={organizerProfilePath(userId)} preview={preview} />;
  }

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

  if (events.length === 0) {
    return <EmptyState>これから開催される催しはありません。</EmptyState>;
  }

  return (
    <div className="stack">
      <Section>
        <SectionHead title="カレンダー" note="催しの開催日を月ごとに確かめられます。" />

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
          <EmptyState>この月に開催される催しはありません。</EmptyState>
        )}

        <SectionHead
          title={<>{formatDayHeading(selectedDate)}</>}
          note={<>{dayEntries.length > 0
              ? `この日の催しは ${dayEntries.length}件です。`
              : "この日に開催される催しはありません。"}</>}
        />
        {dayEntries.length === 0 ? (
          <EmptyState>日付を押すと、その日の催しが出ます。</EmptyState>
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
        <SectionHead title="一覧" note={<>{events.length}件。満員の催しは参加要望を受け付けます。
          </>} />
        <Rows>
          {events.map((event) => (
            <OrganizerPublicEventRow key={event.id} event={event} today={today} />
          ))}
        </Rows>
      </Section>
    </div>
  );
}

/**
 * 未ログインの案内。本物の催しはAPIが返さないので、ここには飾りの骨組みだけを置く。
 * 中身が読めないよう `aria-hidden` にして、案内だけを読み上げさせる。
 */
function LockedSkeleton({ nextPath, preview }: { nextPath: string; preview: boolean }) {
  if (preview) return null;
  const loginHref = `${SITE.nav.participantLogin.href}?next=${encodeURIComponent(nextPath)}`;
  return (
    <section className="organizer-locked">
      <div className="organizer-locked__ghost" aria-hidden="true">
        <div className="card organizer-locked__card" />
        <div className="card organizer-locked__card" />
        <div className="card organizer-locked__card" />
      </div>
      <div className="organizer-locked__notice">
        <p className="panel__title">催しの予定は参加者登録・ログイン後に閲覧できます</p>
        <p className="help">
          主催者が開く催しをカレンダーと一覧で見るには、参加者として登録するかログインしてください。
        </p>
        <div className="btn-row">
          <Link href={loginHref} className="btn btn--primary">
            {SITE.nav.participantLogin.label}
          </Link>
          <Link href={loginHref} className="btn btn--outline">
            参加者として登録する
          </Link>
        </div>
      </div>
    </section>
  );
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
      meta={<>{dates.map((row) => `${row.eventDate} ${row.eventTime}`).join(" ／ ")}
          <br />
          {event.location} ／ {priceLabel(event.pricePlans)}
          <br />
          参加 {event.attendingCount}名
          {event.capacity !== null && ` / 定員 ${event.capacity}名`}</>}
      aside={<><span className="rows__value">{event.isFull ? "満員" : "受付中"}</span></>}
    >
      <div className="btn-row">
          {event.isFull && event.acceptsWaitlist && (
            <span className="badge badge--sm badge--waitlist">参加要望受付中</span>
          )}
          {event.isFull && !event.acceptsWaitlist && (
            <span className="badge badge--sm badge--declined">満員</span>
          )}
          {!event.isFull && event.remainingSeats !== null && (
            <span className="badge badge--sm badge--neutral">残り {event.remainingSeats}名</span>
          )}
          {event.capacity === null && <span className="badge badge--sm badge--neutral">定員なし</span>}
          <Link href={`/events/${event.id}`} className="text-link">
            {event.isFull ? "参加要望を出す" : "出欠を答える"}
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
