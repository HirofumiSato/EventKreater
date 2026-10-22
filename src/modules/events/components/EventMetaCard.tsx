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

export function EventMetaCard({ event }: EventMetaCardProps) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`;
  const remaining = event.capacity === null ? null : Math.max(0, event.capacity - event.attendingCount);
  const ratio = event.capacity ? Math.min(100, Math.round((event.attendingCount / event.capacity) * 100)) : null;
  const owner = event.organizers.owner;
  const coHosts = event.organizers.coHosts;

  return (
    <section className="card card--padded">
      <div className="btn-row">
        <span className="badge badge--sm badge--neutral">{RAIN_POLICY_LABELS[event.rainPolicy]}</span>
        {event.status === "CLOSED" && <span className="badge badge--sm badge--declined">受付停止</span>}
        {event.status === "PUBLISHED" && event.rsvpDeadline && !event.rsvpOpen && (
          <span className="badge badge--sm badge--declined">申し込み期限切れ</span>
        )}
      </div>
      <h1 className="panel__title">{event.title}</h1>
      <dl className="meta-list">
        {owner && (
          <div>
            <dt>主催</dt>
            <dd>
              {owner.userId ? (
                <Link
                  href={`/organizers/${owner.userId}`}
                  className="text-link"
                  aria-label={`${owner.name}さんのプロフィールを見る`}
                >
                  {owner.name}
                </Link>
              ) : (
                owner.name
              )}
            </dd>
          </div>
        )}
        {coHosts.length > 0 && (
          <div>
            <dt>共同主催</dt>
            <dd>
              {coHosts.map((row, index) => (
                <span key={`${row.name}-${index}`}>
                  {index > 0 && "、"}
                  {row.userId ? (
                    <Link
                      href={`/organizers/${row.userId}`}
                      className="text-link"
                      aria-label={`${row.name}さんのプロフィールを見る`}
                    >
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>開催日時</dt>
          <dd>
            <ul className="option-list">
              {event.schedules.map((row) => (
                <li key={row.id}>
                  {row.eventDate} {row.eventTime}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>費用</dt>
          <dd>
            <ul className="option-list">
              {event.pricePlans.map((row) => (
                <li key={row.id}>
                  {row.audience !== "ANY" && (
                    <span className="badge badge--sm badge--neutral">{PRICE_AUDIENCE_LABELS[row.audience]}</span>
                  )}{" "}
                  {row.name} {row.price}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>場所</dt>
          <dd>
            {event.location}
            <br />
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-link">
              Googleマップで開く
            </a>
          </dd>
        </div>
        {event.rsvpDeadline && (
          <div>
            <dt>申し込み期限</dt>
            <dd>
              {formatRsvpDeadlineLabel(event.rsvpDeadline)}
              {event.status === "PUBLISHED" && !event.rsvpOpen ? "（過ぎています）" : ""}
            </dd>
          </div>
        )}
        <div>
          <dt>参加</dt>
          <dd>
            {event.attendingCount}名
            {event.capacity !== null && ` / 定員 ${event.capacity}名`}
            {remaining !== null && remaining > 0 && `（残り ${remaining}名）`}
            {remaining === 0 && "（満員）"}
          </dd>
        </div>
        {event.waitlistCount > 0 && (
          <div>
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
