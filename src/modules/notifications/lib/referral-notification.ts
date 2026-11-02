import { sha256 } from "@/lib/crypto";
import { formatDateSlashJa } from "@/lib/format";
import type { NotificationKind } from "@/modules/notifications/types";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  trimTo,
} from "@/modules/notifications/lib/rsvp-notification";

/**
 * 紹介のチケットが配られたことを、紹介者へ知らせるアプリ内通知の文面。
 *
 * DOM も Next も DB も持たない。誰に作るかは `notify.ts`、何を書くかはここで決める。
 * 紹介の通知は催しに紐づかない（`event_id` は NULL）。押した先はマイページにする。
 */

/** 紹介の通知を押した先。催しに紐づかないので、チケットを見られるマイページへ送る。 */
export const REFERRAL_NOTIFICATION_HREF = "/mypage";

export interface ReferralNotificationContent {
  kind: NotificationKind;
  title: string;
  body: string;
  /** 通知を押した先。 */
  href: string;
}

/**
 * 通知の文面。名前と期限は作成時点のものを焼き付け、後から変わっても過去の通知は動かさない。
 * 枚数は 1 枚にも対応する（生涯上限の端数で 1 枚だけ配ることがある）。
 */
export function buildReferralNotification(input: {
  /** 紹介から登録し、はじめて公開した会員の名前。 */
  name: string;
  /** 配った枚数。 */
  count: number;
  /** 券の有効期限。 */
  expiresAt: Date | string;
}): ReferralNotificationContent {
  const name = input.name.trim();
  const count = Math.max(1, Math.floor(input.count));
  const expires = formatDateSlashJa(input.expiresAt);
  // 名前が取れないときは「さん」を付けない（「紹介された方さん」にしない）。
  const who = name ? `${name}さん` : "紹介された方";

  return {
    kind: "REFERRAL_GRANTED",
    title: trimTo("紹介でチケットが届きました", NOTIFICATION_TITLE_MAX),
    body: trimTo(
      `${who}がはじめて公開しました。チケット${count}枚（${expires} まで）。`,
      NOTIFICATION_BODY_MAX,
    ),
    href: REFERRAL_NOTIFICATION_HREF,
  };
}

/**
 * 同じ人の付与で 2 回作らないための指紋。
 * 紹介 1 件につき通知は 1 行なので、受け取る会員（紹介者）ではなく新しい会員で決める。
 */
export function referralNoticeDedupeKey(newUserId: string): string {
  return sha256(["REFERRAL_GRANTED", newUserId].join("\n"));
}
