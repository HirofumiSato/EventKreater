import type { PublicEventViewer } from "@/modules/events/types";

/**
 * 主催者への誘い（本文のカードと、追従バーの帯）を出してよいか。
 *
 * このイベントの幹事本人（ゲスト幹事の端末 Cookie を含む）と、
 * すでに主催イベントを持つ会員には出さない。すでに主催している人に
 * 「あなたも開きませんか」と言うのは、勧誘ではなく急かしになる。
 * 受付停止（CLOSED）のページでも出す。参加希望者ではなく、次の主催者を拾う導線である。
 */
export function showsOrganizerInvite(viewer: PublicEventViewer): boolean {
  return !viewer.isThisEventsOrganizer && !viewer.hasOrganizerRole;
}
