/**
 * 主催者へのアプリ内通知の型。API の応答と画面が共有する。
 *
 * 文面（`title` / `body`）はサーバーが作成時点で確定して返す。画面側で
 * 状態から文言を組み立て直さないのは、あとで参加者の名前やイベント名が変わっても
 * 過去の通知の意味が変わらないようにするため。
 */

/** 通知の種別。出席と参加要望だけを持つ（欠席・取り消しは知らせない）。 */
export type RsvpNotificationKind = "RSVP_ATTENDING" | "RSVP_WAITLISTED";

export interface RsvpNotification {
  id: string;
  kind: RsvpNotificationKind;
  /** 「参加表明がありました」「参加要望が届きました」。 */
  title: string;
  /** 誰が・どのイベントに・どう応えたか。 */
  body: string;
  eventId: string;
  participantId: string | null;
  /** 押した先（名簿）。サーバーが組み立てる。 */
  href: string;
  /** 読んだ日時。null は未読。 */
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  unreadCount: number;
  notifications: RsvpNotification[];
}
