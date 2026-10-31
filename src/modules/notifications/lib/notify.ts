import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/exceptions";
import type { RsvpStatus } from "@/modules/events/types";
import {
  buildRsvpNotification,
  dedupeKeyFor,
  notificationRecipientIds,
  shouldNotifyRsvp,
} from "@/modules/notifications/lib/rsvp-notification";

/**
 * 参加表明を主催者のアプリ内通知として残す。
 *
 * 出欠のトランザクションがコミットした後に呼ぶ。通知はおまけなので、
 * **ここで失敗しても出欠そのものは成功させる**（呼び出し側が握りつぶす）。
 *
 * 通知はメールを送らない。DB の行を増やすだけなので、件数が増えても費用は掛からない。
 * メールを足すときは `deliver()` の中だけを差し替える。
 */

export interface RsvpSubmittedInput {
  eventId: string;
  /** イベント名。通知の文面へ焼き付ける。 */
  eventTitle: string;
  participantId: string;
  participantName: string;
  /** 出欠した会員。未ログインの端末からの出欠は null。 */
  participantUserId: string | null;
  /** 出欠の行を新しく作ったか。false は既存行の更新。 */
  created: boolean;
  /** 更新前の状態。新規は null。 */
  previousStatus: RsvpStatus | null;
  /** 更新後の状態。 */
  nextStatus: RsvpStatus;
  /** 変化があった時刻。指紋に使い、同じ変化を二重に作らない。 */
  changedAt: Date;
}

export interface NotificationMessage {
  userId: string;
  title: string;
  body: string;
}

/**
 * 通知の配信。いまは何もしない（アプリ内の行を作るだけ）。
 * メールを足すときは、ここで `src/lib/mail.ts` の `deliverMail()` に
 * 同じ `title` / `body` を渡す。`MAIL_WEBHOOK_URL` が空なら `RECORDED` になる。
 */
async function deliver(_messages: readonly NotificationMessage[]): Promise<void> {
  return;
}

/**
 * 主催者ぶんの通知を作る。作った件数を返す（通知しない変化は 0）。
 *
 * 同じ出欠行の同じ変化は `dedupeKey` の一意制約で弾く。同時送信やリトライで
 * 2 回呼ばれても増えない。
 */
export async function notifyRsvpSubmitted(input: RsvpSubmittedInput): Promise<number> {
  const change = {
    created: input.created,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
  };
  if (!shouldNotifyRsvp(change)) return 0;
  // 念のため。`shouldNotifyRsvp` が欠席を弾くが、文面の組み立ては 2 状態しか受けない。
  if (input.nextStatus === "DECLINED") return 0;

  const organizers = await prisma.eventOrganizer.findMany({
    where: { eventId: input.eventId },
    select: { userId: true },
  });
  const recipients = notificationRecipientIds(organizers, input.participantUserId);
  if (recipients.length === 0) return 0;

  const content = buildRsvpNotification({
    eventId: input.eventId,
    eventTitle: input.eventTitle,
    participantName: input.participantName,
    status: input.nextStatus,
  });

  const rows = recipients.map((userId) => ({
    userId,
    eventId: input.eventId,
    participantId: input.participantId,
    kind: content.kind,
    title: content.title,
    body: content.body,
    dedupeKey: dedupeKeyFor({
      userId,
      participantId: input.participantId,
      kind: content.kind,
      changedAt: input.changedAt,
    }),
  }));

  let created = 0;
  try {
    const result = await prisma.notification.createMany({ data: rows, skipDuplicates: true });
    created = result.count;
  } catch (error) {
    // 一意制約は「同じ変化を先に作った別のリクエストがある」だけなので、成功として扱う。
    if (!isUniqueViolation(error)) throw error;
    return 0;
  }

  // アプリ内の行を作った分だけ、配信（いまは何もしない）へ渡す。
  await deliver(rows.map((row) => ({ userId: row.userId, title: row.title, body: row.body })));
  return created;
}
