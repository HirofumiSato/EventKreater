import { sha256 } from "@/lib/crypto";
import type { RsvpStatus } from "@/modules/events/types";
import type { RsvpNotificationKind } from "@/modules/notifications/types";

/**
 * 参加表明を主催者へ知らせるアプリ内通知の、判定と文面。
 *
 * DOM も Next も DB も持たない。誰に作るか・何を書くか・二重に作らない指紋を
 * ここ 1 か所で決め、`notify.ts` が DB へ書く。テストはこのファイルだけで判定を固定できる。
 *
 * 通知するのは「席が増える変化」だけにする。出席の取り消しや欠席への変更まで
 * 知らせると、幹事の未読が催しの人数分だけ膨らんで、本当に見たい 1 件が埋もれる。
 */

export type { RsvpNotificationKind };

/** 通知の題と本文の上限。DB の `VARCHAR` と同じ値。 */
export const NOTIFICATION_TITLE_MAX = 100;
export const NOTIFICATION_BODY_MAX = 300;

export interface RsvpChange {
  /** 出欠の行を新しく作ったか。false は既存行の更新。 */
  created: boolean;
  /** 更新前の状態。新規は null。 */
  previousStatus: RsvpStatus | null;
  /** 更新後の状態。 */
  nextStatus: RsvpStatus;
}

/**
 * この変化を主催者へ知らせるか。
 *
 * | 変化 | 通知 |
 * | :--- | :--- |
 * | 新規 → 出席 / 参加要望 | する |
 * | 欠席 → 出席 / 参加要望 | する |
 * | 参加要望 → 出席 | する |
 * | 同じ状態の再送信 | しない |
 * | 出席 → 参加要望 / 欠席 | しない |
 * | 取り消し（行の削除） | しない（呼ばれない） |
 */
export function shouldNotifyRsvp(change: RsvpChange): boolean {
  // 欠席は席が空く動きなので知らせない。空きが出たことは名簿で分かる。
  if (change.nextStatus === "DECLINED") return false;
  if (change.created) return true;
  if (change.previousStatus === null) return false;
  if (change.previousStatus === "DECLINED") return true;
  // 要望から出席へ上がったときだけ、更新でも知らせる。
  return change.previousStatus === "WAITLISTED" && change.nextStatus === "ATTENDING";
}

export interface RsvpNotificationContent {
  kind: RsvpNotificationKind;
  title: string;
  body: string;
  /** 通知を押した先。名簿の画面。 */
  href: string;
}

/** 名簿へのリンク。通知の行き先を組み立てるのはここだけにする。 */
export function participantsPath(eventId: string): string {
  return `/organizer/events/${eventId}/participants`;
}

/**
 * 通知の文面。催し名・参加者名は作成時点のものを焼き付け、後から変わっても過去の通知は動かさない。
 * `status` は通知する 2 状態だけを受ける（欠席は通知しないため）。
 */
export function buildRsvpNotification(input: {
  eventId: string;
  eventTitle: string;
  participantName: string;
  status: "ATTENDING" | "WAITLISTED";
}): RsvpNotificationContent {
  const name = input.participantName.trim() || "参加者";
  const title = input.eventTitle.trim() || "イベント";

  if (input.status === "WAITLISTED") {
    return {
      kind: "RSVP_WAITLISTED",
      title: trimTo("参加要望が届きました", NOTIFICATION_TITLE_MAX),
      body: trimTo(
        `${name} さんが「${title}」の参加を希望しています。定員に達しているため、名簿から承認できます。`,
        NOTIFICATION_BODY_MAX,
      ),
      href: participantsPath(input.eventId),
    };
  }

  return {
    kind: "RSVP_ATTENDING",
    title: trimTo("参加表明がありました", NOTIFICATION_TITLE_MAX),
    body: trimTo(`${name} さんが「${title}」に出席します。`, NOTIFICATION_BODY_MAX),
    href: participantsPath(input.eventId),
  };
}

/** 上限で切る。絵文字を途中で割らないよう、コードポイント単位で数える。 */
function trimTo(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, max).join("");
}

/**
 * 同じ出欠行の同じ変化を二重に作らないための指紋。
 * 同じ入力なら常に同じ値になり、受け取る会員が違えば別の値になる。
 */
export function dedupeKeyFor(input: {
  userId: string;
  participantId: string;
  kind: RsvpNotificationKind;
  changedAt: Date | string;
}): string {
  const at = input.changedAt instanceof Date ? input.changedAt.toISOString() : input.changedAt;
  return sha256([input.userId, input.participantId, input.kind, at].join("\n"));
}

export interface OrganizerMember {
  userId: string | null;
}

/**
 * 通知を受け取る会員。ゲスト主催者（`userId` を持たない行）は落とし、
 * 同じ会員が二重に主催者行を持っていても 1 回だけ返す。
 * 自分の出欠は自分の通知にしない（`participantUserId`）ので、そこも落とす。
 */
export function notificationRecipientIds(
  organizers: readonly OrganizerMember[],
  participantUserId: string | null,
): string[] {
  const ids = new Set<string>();
  for (const organizer of organizers) {
    if (!organizer.userId) continue;
    if (organizer.userId === participantUserId) continue;
    ids.add(organizer.userId);
  }
  return [...ids];
}

/**
 * 未読数の見た目。札とメニューに出す文字列。
 *
 * 0 件は空文字（要素ごと出さない）、1〜9 はそのまま、10 以上は `9+`。
 * 桁で幅が変わると、390px のヘッダーで札が押し出されるため。
 * 実体は `unread.ts`（クライアントから読めるようにハッシュと分けてある）。
 */
export { formatUnreadCount } from "@/modules/notifications/lib/unread";

