import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { consumeEventQuota, quotaSourceOf } from "@/modules/billing/lib/quota";

/**
 * 受付停止（CLOSED）は公開済みのイベントにだけ意味がある。
 *
 * 下書きを停止にすると、告知ページが無いまま出欠だけ止まった状態になり、
 * プレビューから公開できなくなる。下書きの片付けは削除で行う。
 */
export function assertCanStopEvent(event: { status: string }): void {
  if (event.status !== "DRAFT") return;
  throw new ProblemDetailException({
    status: 409,
    title: "Conflict",
    detail: "下書きは受付停止にできません。削除するか、プレビューから公開してください。",
    error: "DRAFT_CANNOT_STOP",
  });
}

/**
 * 公開の再開は「受付停止にしたイベント」だけを戻す操作である。
 *
 * 状態は CLOSED → PUBLISHED に戻すだけで、枠はここで消費する。
 * 一時停止は枠を空けるので、再開はもう一度枠を1つ使う。満杯なら 402 で断る。
 * 下書きを公開するときは `/publish` を通す（枠の消費と公開の条件が別にある）。
 * 公開中のイベントは、そもそも止まっていないので 409 で断る。
 */
export function assertCanReopenEvent(event: { status: string }): void {
  if (event.status === "CLOSED") return;
  throw new ProblemDetailException({
    status: 409,
    title: "Conflict",
    detail: "受付を停止しているイベントだけ、公開を再開できます。",
    error: "NOT_CLOSED",
  });
}

/**
 * 受付を停止したイベントを公開へ戻す。枠の消費と状態の更新を1つのトランザクションに閉じる。
 * 未登録の幹事（`userId` が null）は利用枠を持たないので、状態だけを戻す。
 */
export async function reopenEvent(userId: string | null, eventId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const quotaSource = userId ? quotaSourceOf(await consumeEventQuota(tx, userId)) : null;
    await tx.event.update({
      where: { id: eventId },
      data: {
        status: "PUBLISHED",
        ...(userId ? { quotaChargedAt: new Date(), quotaSource } : {}),
      },
    });
  });
}
