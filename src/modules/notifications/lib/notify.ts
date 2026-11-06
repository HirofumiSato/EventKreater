import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/exceptions";
import type { RsvpStatus } from "@/modules/events/types";
import { ticketExpiresAt } from "@/modules/billing/lib/tickets";
import {
  buildCoHostJoinedNotification,
  buildCoHostRemovedNotification,
  cohostJoinedRecipientIds,
  cohostNoticeDedupeKey,
  cohostRemovedRecipientIds,
  type CohostRecipientSource,
} from "@/modules/notifications/lib/cohost-notification";
import {
  buildReferralNotification,
  referralNoticeDedupeKey,
} from "@/modules/notifications/lib/referral-notification";
import {
  buildRsvpNotification,
  dedupeKeyFor,
  notificationRecipientIds,
  shouldNotifyRsvp,
} from "@/modules/notifications/lib/rsvp-notification";
import type { NotificationKind } from "@/modules/notifications/types";

/**
 * アプリ内通知を残す。参加表明（`notifyRsvpSubmitted`）、紹介のチケット付与
 * （`notifyReferralGranted`）、共同主催の受諾・解除（`notifyCoHostJoined` /
 * `notifyCoHostRemoved`）の 4 種類を持つ。
 *
 * どれも元になる操作のトランザクションがコミットした後に呼ぶ。通知はおまけなので、
 * **ここで失敗しても本来の操作は成功させる**（呼び出し側が握りつぶす）。
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
  /** 自分を含む参加人数。通知の本文に出す。 */
  partySize?: number;
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
    partySize: input.partySize,
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

export interface ReferralGrantedInput {
  /** チケットを受け取る紹介者。通知の宛先。 */
  referrerId: string;
  /** 紹介リンクから登録し、はじめて公開した会員。指紋に使い、二重に作らない。 */
  newUserId: string;
  /** 今回配った枚数。 */
  granted: number;
}

/**
 * 紹介でチケットが配られたことを紹介者へ知らせる。
 *
 * 公開のトランザクションがコミットした後に呼ぶ。通知はおまけなので、
 * **ここで失敗しても公開そのものは成功させる**（呼び出し側が握りつぶす）。
 * 紹介の通知は催しに紐づかないため `eventId` は null で作る。
 */
export async function notifyReferralGranted(input: ReferralGrantedInput): Promise<number> {
  const newUser = await prisma.user.findUnique({
    where: { id: input.newUserId },
    select: { name: true },
  });
  const content = buildReferralNotification({
    name: newUser?.name ?? "",
    count: input.granted,
    // 付与と同じ規則で期限を出す（紹介券は3か月）。付与の直後に呼ぶので日付は同じになる。
    expiresAt: ticketExpiresAt("REFERRAL", new Date()),
  });

  const row = {
    userId: input.referrerId,
    eventId: null,
    participantId: null,
    kind: content.kind,
    title: content.title,
    body: content.body,
    dedupeKey: referralNoticeDedupeKey(input.newUserId),
  };

  let created = 0;
  try {
    const result = await prisma.notification.createMany({ data: [row], skipDuplicates: true });
    created = result.count;
  } catch (error) {
    // 一意制約は「同じ人の付与を先に知らせた別のリクエストがある」だけなので、成功として扱う。
    if (!isUniqueViolation(error)) throw error;
    return 0;
  }

  if (created > 0) {
    await deliver([{ userId: row.userId, title: row.title, body: row.body }]);
  }
  return created;
}

export interface CoHostJoinedInput {
  eventId: string;
  /** イベント名。通知の文面へ焼き付ける。 */
  eventTitle: string;
  /** 受諾した会員。宛先から除く。 */
  actorUserId: string;
  /** 受諾した会員の名前。文面に使う。 */
  actorName: string;
  /** 受諾で増えた幹事の行。指紋に使い、解除して再招待されると別の値になる。 */
  organizerId: string;
  /** 受諾前の幹事。`userId` を持たないゲスト行は宛先にしない。 */
  organizers: readonly CohostRecipientSource[];
}

/**
 * 共同主催に加わったことを、先に居た幹事へ知らせる。
 *
 * 受諾のトランザクションがコミットした後に呼ぶ。通知はおまけなので、
 * **ここで失敗しても受諾そのものは成功させる**（呼び出し側が握りつぶす）。
 * 受諾した本人と、`userId` を持たないゲスト幹事には作らない。
 */
export async function notifyCoHostJoined(input: CoHostJoinedInput): Promise<number> {
  const recipients = cohostJoinedRecipientIds(input.organizers, input.actorUserId);
  if (recipients.length === 0) return 0;

  const content = buildCoHostJoinedNotification({
    eventId: input.eventId,
    eventTitle: input.eventTitle,
    actorName: input.actorName,
  });

  return createCoHostNotifications(
    recipients.map((userId) => ({
      userId,
      eventId: input.eventId,
      participantId: null,
      kind: content.kind,
      title: content.title,
      body: content.body,
      dedupeKey: cohostNoticeDedupeKey({
        kind: content.kind,
        userId,
        organizerId: input.organizerId,
      }),
    })),
  );
}

export interface CoHostRemovedInput {
  eventId: string;
  /** イベント名。通知の文面へ焼き付ける。 */
  eventTitle: string;
  /** 外れた幹事の行。指紋に使い、再招待で行が変われば別の通知にする。 */
  organizerId: string;
  /** 外れた会員。`userId` を持たないゲスト行は null で、本人へは送らない。 */
  removedUserId: string | null;
  /** 外れた幹事の表示名。文面に使う。 */
  removedName: string;
  /** 解除した会員。宛先から除く。 */
  actorUserId: string;
  /** 解除後に残る幹事。`userId` を持たないゲスト行は宛先にしない。 */
  remainingOrganizers: readonly CohostRecipientSource[];
}

/**
 * 共同主催から外れたことを、外れた本人と残る幹事へ知らせる。
 *
 * 解除のトランザクションがコミットした後に呼ぶ。通知はおまけなので、
 * **ここで失敗しても解除そのものは成功させる**（呼び出し側が握りつぶす）。
 */
export async function notifyCoHostRemoved(input: CoHostRemovedInput): Promise<number> {
  const recipients = cohostRemovedRecipientIds({
    remainingOrganizers: input.remainingOrganizers,
    removedUserId: input.removedUserId,
    actorUserId: input.actorUserId,
  });
  if (recipients.length === 0) return 0;

  // 外れた本人には自分の名前を三人称で書かない。残る幹事には誰が外れたかを添える。
  const selfContent = buildCoHostRemovedNotification({
    eventTitle: input.eventTitle,
    removedName: input.removedName,
    self: true,
  });
  const otherContent = buildCoHostRemovedNotification({
    eventTitle: input.eventTitle,
    removedName: input.removedName,
    self: false,
  });

  return createCoHostNotifications(
    recipients.map((userId) => {
      const content = userId === input.removedUserId ? selfContent : otherContent;
      return {
        userId,
        eventId: input.eventId,
        participantId: null,
        kind: content.kind,
        title: content.title,
        body: content.body,
        dedupeKey: cohostNoticeDedupeKey({
          kind: content.kind,
          userId,
          organizerId: input.organizerId,
        }),
      };
    }),
  );
}

interface CoHostNotificationRow {
  userId: string;
  eventId: string;
  participantId: null;
  kind: NotificationKind;
  title: string;
  body: string;
  dedupeKey: string;
}

/**
 * 共同主催の通知をまとめて作る。同じ指紋の行は一意制約で弾き、成功として扱う。
 * 作った分だけ配信（いまは何もしない）へ渡す。
 */
async function createCoHostNotifications(rows: readonly CoHostNotificationRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let created = 0;
  try {
    const result = await prisma.notification.createMany({ data: [...rows], skipDuplicates: true });
    created = result.count;
  } catch (error) {
    // 一意制約は「同じ受諾・解除を先に作った別のリクエストがある」だけなので、成功として扱う。
    if (!isUniqueViolation(error)) throw error;
    return 0;
  }

  if (created > 0) {
    await deliver(rows.map((row) => ({ userId: row.userId, title: row.title, body: row.body })));
  }
  return created;
}
