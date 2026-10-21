"use client";

import Link from "next/link";
import { formatRsvpDeadlineLabel, priceLabel, scheduleLabel } from "@/lib/serializers";
import { STATUS_LABELS, type OrganizerEvent } from "@/modules/events/types";

interface EventCardProps {
  event: OrganizerEvent;
  busy: boolean;
  onClone: () => void;
  onDelete: () => void;
}

export function EventCard({ event, busy, onClone, onDelete }: EventCardProps) {
  const ratio = event.capacity
    ? Math.min(100, Math.round((event.stats.attendingCount / event.capacity) * 100))
    : null;
  return (
    <article className="card">
      <div className="summary">
        <div>
          <p className="eyebrow eyebrow--muted">
            {STATUS_LABELS[event.status]} · {event.role === "OWNER" ? "筆頭幹事" : "共同幹事"}
          </p>
          <h3 className="summary__name">{event.title}</h3>
          <p className="help">
            {scheduleLabel(event.schedules)} / {priceLabel(event.pricePlans)} / {event.location}
          </p>
          {event.rsvpDeadline && (
            <p className="help">
              申し込み期限 {formatRsvpDeadlineLabel(event.rsvpDeadline)}
              {event.status === "PUBLISHED" && !event.rsvpOpen ? "（過ぎています）" : ""}
            </p>
          )}
        </div>
        {event.flyerThumbnailUrl && <img src={event.flyerThumbnailUrl} alt="" className="event-thumb" />}
      </div>
      <div className="stat-grid" style={{ marginTop: "1rem" }}>
        <div className="stat">
          <p className="stat__label">参加</p>
          <p className="stat__value">{event.stats.attendingCount}</p>
        </div>
        <div className="stat">
          <p className="stat__label">不参加</p>
          <p className="stat__value">{event.stats.declinedCount}</p>
        </div>
        <div className="stat">
          <p className="stat__label">回答</p>
          <p className="stat__value">{event.stats.totalResponses}</p>
        </div>
      </div>
      {ratio !== null && (
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${ratio}%` }} />
        </div>
      )}
      <div className="btn-row" style={{ marginTop: "1rem" }}>
        <Link href={`/events/${event.id}`} className="btn btn--outline btn--sm">
          公開ページ
        </Link>
        <Link href={`/organizer/events/${event.id}/edit`} className="btn btn--sm">
          編集
        </Link>
        <Link href={`/organizer/events/${event.id}/participants`} className="btn btn--sm">
          出欠確認
        </Link>
        <button type="button" onClick={onClone} disabled={busy} className="btn btn--sm">
          コピー作成
        </button>
        {event.role === "OWNER" && (
          <button type="button" onClick={onDelete} disabled={busy} className="btn btn--danger btn--sm">
            削除・停止
          </button>
        )}
      </div>
    </article>
  );
}
