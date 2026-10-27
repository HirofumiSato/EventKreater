"use client";

import { useState } from "react";
import Link from "next/link";
import { formatRsvpDeadlineLabel, scheduleLabel } from "@/lib/serializers";
import { STATUS_LABELS, type OrganizerEvent } from "@/modules/events/types";
import { Badge } from "@/components/ui";

interface EventCardProps {
  event: OrganizerEvent;
  busy: boolean;
  onClone: () => void;
  onDelete: () => void;
}

/** 状態の札。公開中だけ色を付け、停止と下書きは墨のままにする。 */
function statusTone(status: OrganizerEvent["status"]): "success" | "neutral" {
  return status === "PUBLISHED" ? "success" : "neutral";
}

export function EventCard({ event, busy, onClone, onDelete }: EventCardProps) {
  const ratio = event.capacity
    ? Math.min(100, Math.round((event.stats.attendingCount / event.capacity) * 100))
    : null;
  const publicPath = `/events/${event.id}`;
  const [copied, setCopied] = useState(false);

  const copyPublicUrl = async () => {
    if (!event.status || event.status === "DRAFT") return;
    await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article className={`event-card${event.flyerThumbnailUrl ? "" : " event-card--no-thumb"}`}>
      {event.flyerThumbnailUrl ? (
        <img className="event-card__thumb" src={event.flyerThumbnailUrl} alt="" width={1080} height={1920} />
      ) : null}

      <div>
        {/* 札は催し名の頭に並ぶので、名簿の行と同じ小さめの大きさで出す。
            大きいままだと、名前が長い催しで札が 2 行目を奪う。 */}
        <div className="event-card__head">
          <h3 className="event-card__title">{event.title}</h3>
          <Badge tone={statusTone(event.status)} small>
            {STATUS_LABELS[event.status]}
          </Badge>
          <Badge tone="neutral" small>
            {event.role === "OWNER" ? "主催" : "共同主催"}
          </Badge>
        </div>

        {/* 料金プランと主催者名は一覧では持たない。金額は名簿と告知ページで確かめる。 */}
        <p className="event-card__meta">
          {scheduleLabel(event.schedules)} ／ {event.location}
          {event.rsvpDeadline ? (
            <>
              {" "}
              ／ 締切 {formatRsvpDeadlineLabel(event.rsvpDeadline)}
              {event.status === "PUBLISHED" && !event.rsvpOpen ? "（過ぎています）" : ""}
            </>
          ) : null}
        </p>

        <div className="event-card__meter-label">
          <span>
            参加 {event.stats.attendingCount}名 / {event.capacity === null ? "定員なし" : `定員 ${event.capacity}名`}
          </span>
          <span>
            回答 {event.stats.totalResponses}名 ・ 不参加 {event.stats.declinedCount}名
          </span>
        </div>
        {ratio !== null && (
          <div
            className="meter"
            role="img"
            aria-label={`定員${event.capacity}名のうち${event.stats.attendingCount}名が参加`}
          >
            <span style={{ width: `${ratio}%` }} />
          </div>
        )}
      </div>

      {/* 見る系と編集系。幅に応じて 1 段か 2×2 に並ぶ（段数は CSS の格子が決める）。
          編集は一覧でいちばん使うので、塗りと文字色を変えて主の操作として置く。 */}
      <div className="event-card__actions">
        <Link href={`/organizer/events/${event.id}/participants`} className="btn btn--outline btn--sm">
          参加者を見る
        </Link>
        {event.status !== "DRAFT" && (
          <Link href={publicPath} className="btn btn--ghost btn--sm">
            公開ページ
          </Link>
        )}
        <div className="event-card__actions-edit">
          <Link href={`/organizer/events/${event.id}/edit`} className="btn btn--accent btn--sm">
            編集
          </Link>
          <button type="button" onClick={onClone} disabled={busy} className="btn btn--ghost btn--sm">
            コピー作成
          </button>
        </div>
      </div>

      {/* 普段は使わない共有と停止だけを畳む。操作の下に置き、押す前に催しの情報と
          主要な操作が読めるようにする（共有への入口を先に出すと、編集の行き先が埋もれる）。 */}
      {event.status !== "DRAFT" && (
        <details className="fold event-card__fold">
          <summary className="fold__summary">共有と設定</summary>
          <div className="fold__body stack">
            <div className="field">
              <label className="label" htmlFor={`share-url-${event.id}`}>
                参加者に送るURL
              </label>
              <div className="input-row">
                <input
                  className="input"
                  id={`share-url-${event.id}`}
                  readOnly
                  value={publicPath}
                  onFocus={(input) => input.currentTarget.select()}
                />
                <button type="button" className="btn btn--outline btn--sm" onClick={() => void copyPublicUrl()}>
                  {copied ? "コピーしました" : "URLをコピー"}
                </button>
              </div>
            </div>
            {event.role === "OWNER" && (
              <div className="event-card__danger">
                <p className="help">
                  公開をやめると告知ページは見られなくなります。削除すると元に戻せません。
                </p>
                <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={onDelete}>
                  公開をやめる・削除
                </button>
              </div>
            )}
          </div>
        </details>
      )}
    </article>
  );
}
