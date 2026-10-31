"use client";

import Link from "next/link";
import { formatDateTimeMinuteJa } from "@/lib/format";
import { Badge, Row, Rows } from "@/components/ui";
import type { RsvpNotification, RsvpNotificationKind } from "@/modules/notifications/types";

/**
 * 通知の行。マイページの「新着」と通知一覧（SCR-PUB-15）が同じものを並べる。
 *
 * 行を押すと名簿へ移り、その 1 件を既読にする（既読の記録は親が持つ）。
 * 未読の行には「既読」を別の行に置く。題のリンクと押し間違えないよう、
 * リンクの中へ入れ子にしない。
 *
 * 文面と行き先はサーバーが決める。ここは並べるだけで、状態から文言を作り直さない。
 */

const KIND_LABELS: Record<RsvpNotificationKind, string> = {
  RSVP_ATTENDING: "出席",
  RSVP_WAITLISTED: "参加要望",
};

const KIND_TONES: Record<RsvpNotificationKind, "attending" | "waitlist"> = {
  RSVP_ATTENDING: "attending",
  RSVP_WAITLISTED: "waitlist",
};

type NotificationRowsProps = {
  notifications: RsvpNotification[];
  /** 既読の送信中。二重に押せないようにする。 */
  marking: boolean;
  onMarkOne: (notification: RsvpNotification) => void;
  onOpen: (notification: RsvpNotification) => void;
};

export function NotificationRows({
  notifications,
  marking,
  onMarkOne,
  onOpen,
}: NotificationRowsProps) {
  return (
    <Rows>
      {notifications.map((notification) => {
        const unread = notification.readAt === null;
        return (
          <Row
            key={notification.id}
            title={
              <span className="notif__title">
                {unread ? (
                  <>
                    <span className="notif__dot" aria-hidden="true" />
                    <span className="visually-hidden">未読</span>
                  </>
                ) : null}
                <Link
                  href={notification.href}
                  className="text-link"
                  onClick={() => onOpen(notification)}
                >
                  {notification.title}
                </Link>
              </span>
            }
            meta={<span className="notif__body">{notification.body}</span>}
            aside={
              <span className="notif__aside">
                <Badge tone={KIND_TONES[notification.kind]} small>
                  {KIND_LABELS[notification.kind]}
                </Badge>
                <span className="notif__time">
                  {formatDateTimeMinuteJa(notification.createdAt)}
                </span>
              </span>
            }
          >
            {unread ? (
              <div className="notif__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onMarkOne(notification)}
                  disabled={marking}
                >
                  既読
                </button>
              </div>
            ) : null}
          </Row>
        );
      })}
    </Rows>
  );
}
