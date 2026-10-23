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
