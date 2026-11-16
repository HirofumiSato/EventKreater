import { prisma } from "@/lib/prisma";
import { participantsPath } from "@/modules/notifications/lib/rsvp-notification";
import { REFERRAL_NOTIFICATION_HREF } from "@/modules/notifications/lib/referral-notification";
import { COHOST_EVENTS_PATH, cohostEventPath } from "@/modules/notifications/lib/cohost-notification";
import type { NotificationKind, NotificationsResponse, RsvpNotification } from "@/modules/notifications/types";

/**
 * 主催者へのアプリ内通知の読み取り。
 *
 * 通知一覧（SCR-PUB-15）の API と、マイページ（SCR-PUB-03）のサーバーコンポーネントが
 * 同じ 1 本を使う。マイページは 5 件だけ、通知一覧は 50 件まで読む。
 * 行き先（`href`）の組み立てをここ 1 箇所に置き、画面ごとに分けない。
 */

/** 1 行の行き先。出欠は名簿、紹介はマイページ、共同主催はイベントごとに分ける。 */
function hrefFor(row: { kind: NotificationKind; eventId: string | null }): string {
  // 共同主催から外れた人は編集画面を開けないので、主催一覧へ送る。
  if (row.kind === "COHOST_REMOVED") return COHOST_EVENTS_PATH;
  // 紹介の通知は催しを持たない。催しが無い行も同じくマイページへ送る。
  if (row.kind === "REFERRAL_GRANTED" || row.eventId === null) {
    return REFERRAL_NOTIFICATION_HREF;
  }
  // 受諾の通知は、幹事パネルがある編集画面へ送る。
  if (row.kind === "COHOST_JOINED") return cohostEventPath(row.eventId);
  return participantsPath(row.eventId);
}

/** 1 行を画面の形へ。行き先は種別で分ける（組み立ては `hrefFor` の 1 箇所）。 */
function serialize(row: {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  eventId: string | null;
  participantId: string | null;
  readAt: Date | null;
  createdAt: Date;
}): RsvpNotification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    eventId: row.eventId,
    participantId: row.participantId,
    href: hrefFor(row),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 自分の通知を新しい順に読む。未読数は札のバッジとメニューが使う。
 * 本文は作成時点の文面をそのまま返す（イベント名を後から変えても過去の通知は動かない）。
 */
export async function loadNotificationInbox(
  userId: string,
  limit: number,
): Promise<NotificationsResponse> {
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    unreadCount,
    notifications: rows.map(serialize),
  };
}
