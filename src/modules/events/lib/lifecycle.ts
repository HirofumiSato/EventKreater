import { ProblemDetailException } from "@/lib/exceptions";

/**
 * 受付停止（CLOSED）は公開済みの催しにだけ意味がある。
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
 * 公開の再開は「受付停止にした催し」だけを戻す操作である。
 *
 * 公開の手順（告知ページの公開・枠の消費）は済んでいるので、ここでは状態だけを戻す。
 * 下書きを公開するときは `/publish` を通す（枠の消費と公開の条件が別にある）。
 * 公開中の催しは、そもそも止まっていないので 409 で断る。
 */
export function assertCanReopenEvent(event: { status: string }): void {
  if (event.status === "CLOSED") return;
  throw new ProblemDetailException({
    status: 409,
    title: "Conflict",
    detail: "受付を停止している催しだけ、公開を再開できます。",
    error: "NOT_CLOSED",
  });
}
