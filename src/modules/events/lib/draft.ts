import { ProblemDetailException } from "@/lib/exceptions";

/**
 * 下書き保存の入口では状態を変えない。
 * 公開はプレビューの publish だけに集約し、保存ついでに公開される事故を防ぐ。
 */
export function assertDraftSaveStatus(status: string | undefined): void {
  if (!status || status === "DRAFT") return;
  throw new ProblemDetailException({
    status: 400,
    title: "Validation Error",
    detail: "この入口では下書きとしてだけ保存できます。公開はプレビューから行ってください。",
    error: "STATUS_CHANGE_NOT_ALLOWED",
  });
}
