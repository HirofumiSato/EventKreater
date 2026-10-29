"use client";

import Link from "next/link";
import { formatDateTimeJa } from "@/lib/format";
import { Badge, EmptyState, Row, Rows, Section, SectionHead } from "@/components/ui";
import type { RsvpNotification, RsvpNotificationKind } from "@/modules/notifications/types";

/**
 * 主催者マイページの「新着」。参加表明と参加要望を、新しい順に並べる。
 *
 * 行を押すと名簿へ移り、その 1 件を既読にする（既読の記録は親が持つ）。
 * 見出しの右には「すべて既読にする」を置く。未読が無いときは押せない。
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

type NotificationListProps = {
  notifications: RsvpNotification[];
  unreadCount: number;
  /** 既読の送信中。二重に押せないようにする。 */
  marking: boolean;
  onMarkAll: () => void;
  onOpen: (notification: RsvpNotification) => void;
};

export function NotificationList({
  notifications,
  unreadCount,
  marking,
  onMarkAll,
  onOpen,
}: NotificationListProps) {
  return (
    <Section id="notifications" className="notifications">
      <SectionHead
        title="新着"
        note={
          unreadCount > 0
            ? `未読 ${unreadCount}件。参加表明と参加要望を新しい順に出します。`
            : "参加表明と参加要望を新しい順に出します。"
        }
      >
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onMarkAll}
          disabled={marking || unreadCount === 0}
        >
          すべて既読にする
        </button>
      </SectionHead>

      {notifications.length === 0 ? (
        <EmptyState>
          まだ参加表明はありません。参加者が答えると、ここに出ます。
        </EmptyState>
      ) : (
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
                    <span className="notif__time">{formatDateTimeJa(notification.createdAt)}</span>
                  </span>
                }
              />
            );
          })}
        </Rows>
      )}
    </Section>
  );
}
