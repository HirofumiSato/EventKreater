"use client";

import Link from "next/link";
import { formatRsvpDeadlineLabel } from "@/lib/serializers";
import { PRICE_AUDIENCE_LABELS, RAIN_POLICY_LABELS, type PublicEvent } from "@/modules/events/types";

interface EventMetaCardProps {
  event: Pick<
    PublicEvent,
    | "title"
    | "schedules"
    | "pricePlans"
    | "location"
    | "rainPolicy"
    | "capacity"
    | "attendingCount"
    | "waitlistCount"
    | "status"
    | "rsvpDeadline"
    | "rsvpOpen"
    | "organizers"
  >;
}

/* チラシの下に置く「紙」1 枚。催し名・主催・事実の順に読み、
   数字（残席）は最後に置く。読む順が、申し込む順になっている。 */
export function EventMetaCard({ event }: EventMetaCardProps) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`;
  const remaining = event.capacity === null ? null : Math.max(0, event.capacity - event.attendingCount);
  const ratio = event.capacity ? Math.min(100, Math.round((event.attendingCount / event.capacity) * 100)) : null;
  const owner = event.organizers.owner;
  const coHosts = event.organizers.coHosts;

  return (
    <section className="event-sheet">
      <h1 className="event-sheet__title">{event.title}</h1>
      {(owner || coHosts.length > 0) && (
        <p className="event-sheet__host">
          主催:{" "}
          {owner && (
            <>
              {owner.userId ? (
                <Link href={`/organizers/${owner.userId}`} aria-label={`${owner.name}さんのプロフィールを見る`}>
                  {owner.name}
                </Link>
              ) : (
                owner.name
              )}
            </>
          )}
          {coHosts.length > 0 && (
            <>
              {owner ? "／" : null}
              共同主催:{" "}
              {coHosts.map((row, index) => (
                <span key={`${row.name}-${index}`}>
                  {index > 0 && "、"}
                  {row.userId ? (
                    <Link href={`/organizers/${row.userId}`} aria-label={`${row.name}さんのプロフィールを見る`}>
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </span>
              ))}
            </>
          )}
        </p>
      )}

      <div className="event-sheet__badges">
        <span className="badge badge--sm badge--neutral">{RAIN_POLICY_LABELS[event.rainPolicy]}</span>
        {event.status === "CLOSED" && <span className="badge badge--sm badge--declined">受付停止</span>}
        {event.status === "PUBLISHED" && event.rsvpDeadline && !event.rsvpOpen && (
          <span className="badge badge--sm badge--declined">申し込み期限切れ</span>
        )}
        {event.capacity !== null && (
          <span className="badge badge--sm badge--neutral">
            {remaining === 0 ? "満員" : `定員 ${event.capacity}名`}
          </span>
        )}
        {event.rsvpDeadline && (
          <span className="badge badge--sm badge--warning">
            締切 {formatRsvpDeadlineLabel(event.rsvpDeadline)}
            {event.status === "PUBLISHED" && !event.rsvpOpen ? "（過ぎています）" : ""}
          </span>
        )}
      </div>

      <dl className="event-facts">
        <div className="event-facts__row">
          <dt>日時</dt>
          <dd>
            {event.schedules.map((row) => (
              <span key={row.id} className="event-facts__line">
                {row.eventDate} {row.eventTime}
              </span>
            ))}
          </dd>
        </div>
        <div className="event-facts__row">
          <dt>場所</dt>
          <dd>
            {event.location}
            <br />
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-link">
              Googleマップで開く
            </a>
          </dd>
        </div>
        <div className="event-facts__row">
          <dt>費用</dt>
          <dd>
            {event.pricePlans.map((row) => (
              <span key={row.id} className="event-facts__line">
                {row.audience !== "ANY" && `${PRICE_AUDIENCE_LABELS[row.audience]} `}
                {row.name} {row.price}
              </span>
            ))}
          </dd>
        </div>
        <div className="event-facts__row">
          <dt>参加</dt>
          <dd>
            {event.attendingCount}名
            {event.capacity !== null && ` / 定員 ${event.capacity}名`}
            {remaining !== null && remaining > 0 && `（残り ${remaining}名）`}
            {remaining === 0 && "（満員）"}
          </dd>
        </div>
        {event.waitlistCount > 0 && (
          <div className="event-facts__row">
            <dt>参加要望</dt>
            <dd>
              {event.waitlistCount}名
              {remaining === 0 && event.rsvpOpen && "（空きが出たら幹事が順番に承認します）"}
            </dd>
          </div>
        )}
      </dl>
      {ratio !== null && (
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${ratio}%` }} />
        </div>
      )}
    </section>
  );
}
