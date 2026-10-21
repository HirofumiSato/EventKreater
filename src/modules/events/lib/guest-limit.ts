import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";

/**
 * 未登録のまま作れるイベントは1件だけ。2件目からは会員登録に送る。
 *
 * 数えるのは筆頭幹事（OWNER）として作った分だけ。共同幹事（CO_HOST）として
 * 招待を受けた行は「自分のイベント」ではないので含めない。
 * 削除済みも数える。会員の無料枠が削除で戻らないのと同じく、作成の消費として扱う。
 */
export async function assertGuestCanCreate(guestTokenHashes: string[]): Promise<void> {
  if (guestTokenHashes.length === 0) return;
  const owned = await prisma.eventOrganizer.count({
    where: { guestTokenHash: { in: guestTokenHashes }, role: "OWNER" },
  });
  if (owned < 1) return;
  throw new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    type: "probs/register-required",
    detail:
      "2件目のイベント作成には会員登録が必要です。登録すると、いま公開したイベントもあなたのアカウントに引き継がれます。",
    error: "REGISTER_REQUIRED",
  });
}
