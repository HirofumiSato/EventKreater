import { describe, expect, it } from "vitest";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertCanStopEvent } from "@/modules/events/lib/lifecycle";

/**
 * 受付停止（CLOSED）は公開済みの催しにだけ意味がある。
 * 下書きを停止にすると、告知ページが無いまま公開できない状態になるため 409 で断る。
 */
describe("下書きの受付停止", () => {
  it("下書きは 409 DRAFT_CANNOT_STOP で断る", () => {
    try {
      assertCanStopEvent({ status: "DRAFT" });
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      const problem = error as ProblemDetailException;
      expect(problem.status).toBe(409);
      expect(problem.extras.error).toBe("DRAFT_CANNOT_STOP");
    }
  });

  it("公開中と受付停止は通す", () => {
    expect(() => assertCanStopEvent({ status: "PUBLISHED" })).not.toThrow();
    expect(() => assertCanStopEvent({ status: "CLOSED" })).not.toThrow();
  });
});
