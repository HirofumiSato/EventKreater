import { describe, expect, it } from "vitest";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertCanReopenEvent, assertCanStopEvent } from "@/modules/events/lib/lifecycle";

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

/**
 * 公開の再開は、受付停止にした催しだけを戻す操作である。
 * 下書きの公開は `/publish`（枠の消費と公開の条件）を通すので、ここでは通さない。
 */
describe("公開の再開", () => {
  it("受付停止は公開中へ戻せる", () => {
    expect(() => assertCanReopenEvent({ status: "CLOSED" })).not.toThrow();
  });

  it("公開中と下書きは 409 NOT_CLOSED で断る", () => {
    for (const status of ["PUBLISHED", "DRAFT"]) {
      try {
        assertCanReopenEvent({ status });
        throw new Error("例外が出ませんでした");
      } catch (error) {
        expect(error).toBeInstanceOf(ProblemDetailException);
        const problem = error as ProblemDetailException;
        expect(problem.status).toBe(409);
        expect(problem.extras.error).toBe("NOT_CLOSED");
      }
    }
  });
});
