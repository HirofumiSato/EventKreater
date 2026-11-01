"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { scheduleLabel } from "@/lib/serializers";
import { STATUS_LABELS, type OrganizerEvent } from "@/modules/events/types";
import { LineShareButton } from "@/modules/organizers/components/LineShareButton";
import { Badge } from "@/components/ui";

interface EventCardProps {
  event: OrganizerEvent;
  busy: boolean;
  onClone: () => void;
  /** 出欠の受付を止める（告知ページは残す）。 */
  onStop: () => void;
  /** 受付停止を公開中へ戻す。 */
  onResume: () => void;
  /** 削除の確認を開く。 */
  onDelete: () => void;
}

/** 状態の札。公開中だけ色を付け、停止と下書きは墨のままにする。 */
function statusTone(status: OrganizerEvent["status"]): "success" | "neutral" {
  return status === "PUBLISHED" ? "success" : "neutral";
}

export function EventCard({ event, busy, onClone, onStop, onResume, onDelete }: EventCardProps) {
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

  // チラシは告知ページへの入口も兼ねる。下書きには公開ページが無いので、絵のまま置く。
  const thumb = event.flyerThumbnailUrl ? (
    <img className="event-card__thumb" src={event.flyerThumbnailUrl} alt="" width={1080} height={1920} />
  ) : null;

  return (
    <article className={`event-card${event.flyerThumbnailUrl ? "" : " event-card--no-thumb"}`}>
      {thumb !== null &&
        (event.status === "DRAFT" ? (
          thumb
        ) : (
          <Link
            className="event-card__thumb-link"
            href={publicPath}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${event.title}の公開ページを新しいウィンドウで開く`}
          >
            {thumb}
          </Link>
        ))}

      <div>
        {/* 札はイベント名の頭に並ぶので、名簿の行と同じ小さめの大きさで出す。
            大きいままだと、名前が長いイベントで札が 2 行目を奪う。 */}
        <div className="event-card__head">
          <h3 className="event-card__title">{event.title}</h3>
          <Badge tone={statusTone(event.status)} small>
            {STATUS_LABELS[event.status]}
          </Badge>
          <Badge tone="neutral" small>
            {event.role === "OWNER" ? "主催" : "共同主催"}
          </Badge>
        </div>

        {/* 料金プラン・主催者名・申込の締切は一覧では持たない。日時と場所だけを 1 行に収め、
            締切と金額は名簿と告知ページで確かめる。 */}
        <p className="event-card__meta">
          {scheduleLabel(event.schedules)} ／ {event.location}
        </p>

        <div className="event-card__meter-label">
          <span>
            参加 {event.stats.attendingCount}名 / {event.capacity === null ? "定員なし" : `定員 ${event.capacity}名`}
          </span>
          <span>
            回答 {event.stats.totalResponses}件 ・ 欠席 {event.stats.declinedCount}件
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

      {/* 札の上に常に出すのは「出欠」と「編集」の 2 つだけ。幅が変わっても 2 列のまま
          （段数は CSS の格子が決める）。編集は一覧でいちばん使うので、塗りで主の操作にする。 */}
      <div className="event-card__actions">
        <Link href={`/organizer/events/${event.id}/participants`} className="btn btn--outline btn--sm">
          出欠
        </Link>
        <Link href={`/organizer/events/${event.id}/edit`} className="btn btn--accent btn--sm">
          編集
        </Link>
      </div>

      {/* 残りの操作は 1 段にまとめ、札を縦に伸ばさないよう折りたたむ。並びは読み上げと
          焦点の順に合わせ、見る系 → 共有 → 編集系 → 停止・削除 とする。 */}
      <details className="event-card__more">
        <summary className="event-card__more-summary">
          その他の操作
          <ChevronDown className="icon" aria-hidden="true" />
        </summary>
        <div className="event-card__more-body">
          {/* 告知ページは、チラシが無くても必ず辿れるようにする。下書きには公開ページが無い。 */}
          {event.status !== "DRAFT" && (
            <a
              href={publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="event-card__public-link btn btn--outline btn--sm"
            >
              公開ページ
            </a>
          )}
          {/* 下書きは配る先が無い。告知ページのある催しだけ、その場で LINE へ渡せるようにする。 */}
          {event.status !== "DRAFT" && (
            <LineShareButton
              title={event.title}
              schedules={event.schedules}
              location={event.location}
              path={publicPath}
              className="btn btn--outline btn--sm"
            />
          )}
          {/* 押した結果はボタンの文字と、下の読み上げ用の 1 行で伝える。 */}
          {event.status !== "DRAFT" && (
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => void copyPublicUrl()}
            >
              {copied ? "コピーしました" : "URLをコピー"}
            </button>
          )}
          <button type="button" onClick={onClone} disabled={busy} className="btn btn--outline btn--sm">
            コピー作成
          </button>
          {event.role === "OWNER" && (
            <>
              {event.status === "CLOSED" ? (
                <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={onResume}>
                  再開
                </button>
              ) : (
                <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={onStop}>
                  停止
                </button>
              )}
              <button
                type="button"
                className="btn btn--danger btn--sm event-card__delete"
                disabled={busy}
                onClick={onDelete}
              >
                削除
              </button>
            </>
          )}
        </div>
        <span className="visually-hidden" role="status" aria-live="polite">
          {copied ? "URLをコピーしました" : ""}
        </span>
      </details>
    </article>
  );
}
