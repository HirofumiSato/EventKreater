/**
 * 主催者へのアプリ内通知の型。API の応答と画面が共有する。
 *
 * 文面（`title` / `body`）はサーバーが作成時点で確定して返す。画面側で
 * 状態から文言を組み立て直さないのは、あとで参加者の名前やイベント名が変わっても
 * 過去の通知の意味が変わらないようにするため。
 */

/**
 * 通知の種別。出席・参加要望、紹介でのチケット付与、共同主催の受諾・解除を持つ
 * （欠席・取り消しは知らせない）。
 */
export type NotificationKind =
  | "RSVP_ATTENDING"
  | "RSVP_WAITLISTED"
  | "REFERRAL_GRANTED"
  | "COHOST_JOINED"
  | "COHOST_REMOVED";

/** 旧名。出席・参加要望だけを指していた頃の呼び出しを壊さないための別名。 */
export type RsvpNotificationKind = NotificationKind;

export interface RsvpNotification {
  id: string;
  kind: NotificationKind;
  /** 「参加表明がありました」「参加要望が届きました」「紹介でチケットが届きました」。 */
  title: string;
  /** 誰が・どの催しに・どう応えたか。紹介は誰がはじめて公開したか。 */
  body: string;
  /** 催し。紹介の通知は催しに紐づかないため null。 */
  eventId: string | null;
  participantId: string | null;
  /** 押した先。出欠は名簿、紹介はマイページ。サーバーが組み立てる。 */
  href: string;
  /** 読んだ日時。null は未読。 */
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  unreadCount: number;
  notifications: RsvpNotification[];
}
