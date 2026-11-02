import type { FreeTicketSource } from "@prisma/client";
import { addMonthsUtc } from "@/modules/billing/lib/pricing";

/**
 * 期限つきの無料チケットの数え方だけを持つ。
 *
 * DOM も Next も DB も持たない。残数の数え上げや `FOR UPDATE` は `quota.ts` 側に置き、
 * ここは「どの券を先に使うか」「次はいつ配れるか」の判断だけを扱う。
 */

/** 動画券の有効日数。短くして、見た当日に使わせる。 */
export const AD_TICKET_DAYS = 7;

/** 紹介券の有効月数。紹介の網が届くまで待てる長さにする。 */
export const REFERRAL_TICKET_MONTHS = 3;

/** 紹介1件で配る枚数。 */
export const REFERRAL_TICKET_GRANT = 2;

/** 紹介で受け取れる生涯の上限。 */
export const REFERRAL_TICKET_LIMIT = 10;

/**
 * 動画券を配る間隔（日）。暦月にしない。
 * 暦月だと1月31日と2月1日で2枚になり、月1枚の約束が崩れる。
 */
export const AD_TICKET_INTERVAL_DAYS = 30;

/** 1日をミリ秒で表した値。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 期限が最も近い券を1枚選ぶ。期限切れは返さない。
 *
 * `usedAt` は見ない。使った券を除くのは呼び出し側の条件（`usedAt: null`）の責務にする。
 * 期限が同じ券が複数あるときは入力の順をそのまま使う（`sort` は安定）。
 */
export function pickUsableTicket<T extends { expiresAt: Date }>(
  tickets: T[],
  now: Date,
): T | null {
  const usable = tickets
    .filter((ticket) => ticket.expiresAt.getTime() > now.getTime())
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  return usable[0] ?? null;
}

/**
 * 次の動画券を配れる日時。すぐ配れるなら null。
 *
 * 前回の発行から30日を過ぎていれば null を返す（制限なし）。まだ1枚も配っていない
 * 会員も null で、初回はいつでも配れる。
 */
export function nextAdGrantAt(lastIssuedAt: Date | null, now: Date): Date | null {
  if (lastIssuedAt === null) return null;
  const next = new Date(lastIssuedAt.getTime() + AD_TICKET_INTERVAL_DAYS * DAY_MS);
  return next.getTime() > now.getTime() ? next : null;
}

/**
 * 紹介1件で配る枚数。生涯上限を超える端数は落とす。
 * 9枚受け取っていれば1枚、10枚なら0枚。負の数は0として扱う。
 */
export function referralGrantSize(grantedCount: number): 0 | 1 | 2 {
  const remaining = REFERRAL_TICKET_LIMIT - Math.max(0, grantedCount);
  if (remaining <= 0) return 0;
  return remaining === 1 ? 1 : REFERRAL_TICKET_GRANT;
}

/**
 * 発行日時から有効期限を出す。
 * 動画券は7日、紹介券と運営の付与は3か月（`addMonthsUtc` で月末を丸める）。
 */
export function ticketExpiresAt(source: FreeTicketSource, issuedAt: Date): Date {
  if (source === "AD") {
    return new Date(issuedAt.getTime() + AD_TICKET_DAYS * DAY_MS);
  }
  return addMonthsUtc(issuedAt, REFERRAL_TICKET_MONTHS);
}
