import { sha256 } from "@/lib/crypto";
import type { NotificationKind } from "@/modules/notifications/types";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  trimTo,
} from "@/modules/notifications/lib/rsvp-notification";

/**
 * 共同主催の受諾・解除を、幹事へ知らせるアプリ内通知の文面と宛先。
 *
 * DOM も Next も DB も持たない。誰に作るかは `notify.ts`、何を書くかと
 * 二重に作らない指紋はここで決める。メールは送らない（アプリ内の行だけを残す）。
 */

/** この機能が扱う種別。題と本文の組み立てを種別ごとに分ける。 */
export type CohostNotificationKind = Extract<
  NotificationKind,
  "COHOST_JOINED" | "COHOST_REMOVED"
>;

/** 受諾の通知を押した先。幹事パネルがある編集画面。 */
export function cohostEventPath(eventId: string): string {
  return `/organizer/events/${eventId}/edit`;
}

/** 解除の通知を押した先。外れた人は編集画面を開けないので、主催一覧へ送る。 */
export const COHOST_EVENTS_PATH = "/organizer/events";

export interface CohostNotificationContent {
  kind: CohostNotificationKind;
  title: string;
  body: string;
  /** 通知を押した先。 */
  href: string;
}

/** 名前が取れないときに「さん」を付けないための組み立て。 */
function withSan(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed}さん` : fallback;
}

/**
 * 共同主催に加わったことを、先に居た幹事へ知らせる文面。
 * イベント名と受諾者の名前は作成時点のものを焼き付け、後から変わっても過去の通知は動かさない。
 */
export function buildCoHostJoinedNotification(input: {
  eventId: string;
  eventTitle: string;
  /** 受諾した会員の名前。空なら役割名で書く。 */
  actorName: string;
}): CohostNotificationContent {
  const title = input.eventTitle.trim() || "イベント";
  const who = withSan(input.actorName, "新しい共同主催");

  return {
    kind: "COHOST_JOINED",
    title: trimTo("共同主催が加わりました", NOTIFICATION_TITLE_MAX),
    body: trimTo(
      `${who}が「${title}」の共同主催・幹事に加わりました。`,
      NOTIFICATION_BODY_MAX,
    ),
    href: cohostEventPath(input.eventId),
  };
}

/**
 * 共同主催から外れたことを知らせる文面。
 *
 * 外れた本人には「外れました」とだけ伝え、残る幹事には誰が外れたかを添える。
 * 本人宛に自分の名前を三人称で書くと、誰の話か読み取りにくくなるため。
 */
export function buildCoHostRemovedNotification(input: {
  eventTitle: string;
  /** 外れた幹事の表示名。空なら役割名で書く。 */
  removedName: string;
  /** 外れた本人へ出すか。false は残る幹事へ出す。 */
  self: boolean;
}): CohostNotificationContent {
  const title = input.eventTitle.trim() || "イベント";
  const who = withSan(input.removedName, "共同主催");
  const body = input.self
    ? `「${title}」の共同主催・幹事から外れました。`
    : `${who}が「${title}」の共同主催・幹事から外れました。`;

  return {
    kind: "COHOST_REMOVED",
    title: trimTo("共同主催が外れました", NOTIFICATION_TITLE_MAX),
    body: trimTo(body, NOTIFICATION_BODY_MAX),
    href: COHOST_EVENTS_PATH,
  };
}

/** 受諾前の幹事。`userId` を持たないゲスト行は宛先にしない。 */
export interface CohostRecipientSource {
  userId: string | null;
}

/**
 * 受諾を知らせる相手。`userId` を持つ幹事だけを、重複なく 1 回ずつ返し、
 * 受諾した本人（行為者）は除く。
 */
export function cohostJoinedRecipientIds(
  organizers: readonly CohostRecipientSource[],
  actorUserId: string,
): string[] {
  const ids = new Set<string>();
  for (const organizer of organizers) {
    if (!organizer.userId) continue;
    if (organizer.userId === actorUserId) continue;
    ids.add(organizer.userId);
  }
  return [...ids];
}

/**
 * 解除を知らせる相手。外れた本人（`userId` がある場合）と、行為者以外の残る幹事。
 * ゲスト行は宛先にせず、同じ会員が二重に主催者行を持っても 1 回だけ返す。
 */
export function cohostRemovedRecipientIds(input: {
  remainingOrganizers: readonly CohostRecipientSource[];
  /** 外れた幹事の会員。ゲスト行は null。 */
  removedUserId: string | null;
  /** 解除した行為者。 */
  actorUserId: string;
}): string[] {
  const ids = new Set<string>();
  if (input.removedUserId && input.removedUserId !== input.actorUserId) {
    ids.add(input.removedUserId);
  }
  for (const organizer of input.remainingOrganizers) {
    if (!organizer.userId) continue;
    if (organizer.userId === input.actorUserId) continue;
    ids.add(organizer.userId);
  }
  return [...ids];
}

/**
 * 同じ受諾・解除を二重に作らないための指紋。
 *
 * 幹事の行 ID を混ぜるので、解除して再招待されると行が変わり、同じ会員でも
 * 前回の通知と衝突しない。受け取る会員ごとに 1 行なので `userId` も混ぜる。
 */
export function cohostNoticeDedupeKey(input: {
  kind: CohostNotificationKind;
  userId: string;
  organizerId: string;
}): string {
  return sha256(["cohost", input.kind, input.userId, input.organizerId].join("\n"));
}
