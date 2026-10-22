"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarMonthGrid, CalendarToolbar } from "@/components/common/CalendarMonth";
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
  toOrganizerCellItem,
  upcomingSchedules,
} from "@/modules/organizers/lib/public-page";
import type { PublicOrganizerEvent, PublicOrganizerPage } from "@/modules/events/types";

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
 * 主催者の公開ページ。カレンダーと一覧をタブで切り替える。
 *
 * 未ログインではAPIが 403 を返すので、中身は描かずに骨組みをぼかして案内を重ねる。
 * サーバー側でも催しを返さないため、DOM を見ても内容は分からない。
 */
export function OrganizerPageView({ userId, preview = false }: OrganizerPageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryView = searchParams.get("view") === "list" ? "list" : "calendar";
  const queryMonth = searchParams.get("month");
  const today = useMemo(() => todayInTokyo(), []);
  const minMonth = today.slice(0, 7);

  const [view, setViewState] = useState<"calendar" | "list">(queryView);
  const [month, setMonth] = useState(() => clampMonth(queryMonth, minMonth));
  const [selectedDate, setSelectedDate] = useState(() => defaultSelectedDate(clampMonth(queryMonth, minMonth)));
  const [data, setData] = useState<PublicOrganizerPage | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/public/organizers/${userId}`, { cache: "no-store" });
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

  // ブラウザの戻る・進むでクエリが変わったとき、表示中の月とタブも合わせる。
  useEffect(() => {
    if (preview) return;
    setViewState(queryView);
  }, [queryView, preview]);

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

  const setView = (next: "calendar" | "list") => {
    setViewState(next);
    if (preview) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    if (next === "calendar") params.set("month", month);
    else params.delete("month");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const goToMonth = (next: string) => {
    if (next < minMonth) return;
    setMonth(next);
    setSelectedDate(defaultSelectedDate(next));
    if (preview) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "calendar");
    params.set("month", next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  if (state === "login") {
    return (
      <div className="stack">
        <OrganizerHeader name={null} preview={preview} />
        <LockedSkeleton nextPath={`/organizers/${userId}`} preview={preview} />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="stack">
        <OrganizerHeader name={null} />
        <p className="alert alert--error">{error}</p>
        <Link href="/events" className="btn btn--outline">
          イベントを探す
        </Link>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="stack">
        <OrganizerHeader name={null} />
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <OrganizerHeader name={data?.organizer.name ?? null} preview={preview} />

      <section className="panel">
        <div className="segment" role="tablist" aria-label="表示の切り替え">
          <label className="segment__item">
            <input
              type="radio"
              name="organizer-view"
              checked={view === "calendar"}
              onChange={() => setView("calendar")}
            />
            カレンダー
          </label>
          <label className="segment__item">
            <input
              type="radio"
              name="organizer-view"
              checked={view === "list"}
              onChange={() => setView("list")}
            />
            一覧
          </label>
        </div>
      </section>

      {events.length === 0 ? (
        <section className="card">
          <p className="empty">これから開催される催しはありません。</p>
        </section>
      ) : view === "calendar" ? (
        <>
          <section className="panel calendar-toolbar">
            <div className="calendar-toolbar__nav">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => goToMonth(shiftMonth(month, -1))}
                disabled={!canGoPrev}
              >
                前月
              </button>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => goToMonth(shiftMonth(month, 1))}
              >
                次月
              </button>
              {month !== todayMonth && (
                <button type="button" className="btn btn--sm" onClick={() => goToMonth(todayMonth)}>
                  今月
                </button>
              )}
            </div>
            <p className="calendar-toolbar__month" aria-live="polite">
              {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
            </p>
          </section>

          {monthEntryCount === 0 && (
            <section className="card calendar-empty">
              <p>この月に開催される催しはありません。</p>
            </section>
          )}

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

            <section className="card calendar-day" aria-labelledby="organizer-calendar-day-heading">
              <div className="calendar-day__head">
                <h2 id="organizer-calendar-day-heading" className="card__title">
                  {formatDayHeading(selectedDate)}
                </h2>
                <p className="help">{dayEntries.length > 0 ? `${dayEntries.length}件` : ""}</p>
              </div>
              {dayEntries.length === 0 ? (
                <p className="empty">この日に開催される催しはありません。</p>
              ) : (
                <ul className="calendar-day__list">
                  {dayEntries.map((entry) => (
                    <li key={`${entry.event.id}:${entry.schedule.eventTime}`} className="calendar-day__item">
                      <Link href={`/events/${entry.event.id}`} className="calendar-day__link">
                        <span className="calendar-day__time">{entry.schedule.eventTime || "時刻未定"}</span>
                        <span className="calendar-day__title">{entry.event.title}</span>
                        <span className="calendar-day__meta">
                          {entry.event.location}
                          {entry.event.isFull ? " · 参加要望受付中" : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : (
        <section className="stack">
          {events.map((event) => (
            <OrganizerPublicEventCard key={event.id} event={event} today={today} />
          ))}
        </section>
      )}
    </div>
  );
}

function OrganizerHeader({ name, preview = false }: { name: string | null; preview?: boolean }) {
  return (
    <section className="panel">
      <div>
        <p className="eyebrow">主催者の催し</p>
        <h1 className="page-title">{name ? `${name}さんの催し` : "主催者の催し"}</h1>
        <p className="page-lead">これから開催される催しを、カレンダーと一覧で確認できます。</p>
      </div>
      {!preview && (
        <div className="panel__actions">
          <Link href="/participant" className="btn btn--outline">
            参加者ホームへ
          </Link>
        </div>
      )}
    </section>
  );
}

/**
 * 未ログインの案内。本物の催しはAPIが返さないので、ここには飾りの骨組みだけを置く。
 * 中身が読めないよう `aria-hidden` にして、案内だけを読み上げさせる。
 */
function LockedSkeleton({ nextPath, preview }: { nextPath: string; preview: boolean }) {
  if (preview) return null;
  return (
    <section className="organizer-locked">
      <div className="organizer-locked__ghost" aria-hidden="true">
        <div className="card organizer-locked__card" />
        <div className="card organizer-locked__card" />
        <div className="card organizer-locked__card" />
      </div>
      <div className="organizer-locked__notice">
        <p className="panel__title">このページは参加者登録・ログイン後に閲覧できます</p>
        <p className="help">
          主催者の催しをまとめて見るには、参加者として登録するかログインしてください。
        </p>
        <div className="btn-row">
          <Link
            href={`${SITE.nav.participantLogin.href}?next=${encodeURIComponent(nextPath)}`}
            className="btn btn--primary"
          >
            {SITE.nav.participantLogin.label}
          </Link>
          <Link href="/participant/login" className="btn btn--outline">
            参加者として登録する
          </Link>
        </div>
      </div>
    </section>
  );
}

function OrganizerPublicEventCard({ event, today }: { event: PublicOrganizerEvent; today: string }) {
  const dates = upcomingSchedules(event, today);
  const ratio =
    event.capacity !== null && event.capacity > 0
      ? Math.min(100, Math.round((event.attendingCount / event.capacity) * 100))
      : null;
  return (
    <article className="card">
      <div className="summary">
        <div>
          <h3 className="summary__name">
            <Link href={`/events/${event.id}`} className="card__title">
              {event.title}
            </Link>
          </h3>
          <ul className="option-list">
            {dates.map((row) => (
              <li key={row.id}>
                {row.eventDate} {row.eventTime}
              </li>
            ))}
          </ul>
          <p className="help">
            {priceLabel(event.pricePlans)} / {event.location}
          </p>
          <div className="btn-row" style={{ marginTop: "0.25rem" }}>
            {event.isFull && event.acceptsWaitlist && (
              <span className="badge badge--sm badge--waitlist">参加要望受付中</span>
            )}
            {event.isFull && !event.acceptsWaitlist && (
              <span className="badge badge--sm badge--declined">満員</span>
            )}
            {!event.isFull && event.remainingSeats !== null && (
              <span className="badge badge--sm badge--neutral">残り {event.remainingSeats}名</span>
            )}
            {event.capacity === null && (
              <span className="badge badge--sm badge--neutral">定員なし</span>
            )}
          </div>
        </div>
        {event.flyerThumbnailUrl && (
          <img src={event.flyerThumbnailUrl} alt="" className="event-thumb" />
        )}
      </div>
      <p className="help">
        参加 {event.attendingCount}名
        {event.capacity !== null && ` / 定員 ${event.capacity}名`}
      </p>
      {ratio !== null && (
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${ratio}%` }} />
        </div>
      )}
      <div className="btn-row" style={{ marginTop: "0.75rem" }}>
        <Link href={`/events/${event.id}`} className="btn btn--outline btn--sm">
          {event.isFull ? "参加要望を出す" : "出欠を答える"}
        </Link>
      </div>
    </article>
  );
}
