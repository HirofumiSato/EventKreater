import { describe, expect, it } from "vitest";
import { SaveEventDraftSchema } from "@/lib/schemas";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertDraftSaveStatus } from "@/modules/events/lib/draft";
import {
  firstIncompleteDraftStep,
  isDraftReady,
  resumeStepKey,
} from "@/modules/events/lib/steps";
import {
  EMPTY_EVENT_FORM,
  createPricePlanDraft,
  createScheduleDraft,
  toEventRequest,
  type EventFormValues,
} from "@/modules/events/types";

function draftPayload(overrides: Record<string, unknown> = {}) {
  return {
    ...toEventRequest({
      ...EMPTY_EVENT_FORM,
      title: "下書きの催し",
      schedules: [
        {
          ...createScheduleDraft(),
          eventDate: "2026-12-01",
          startTime: "19:00",
          endTime: "21:00",
        },
      ],
      pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000" })],
      venueName: "テスト会場",
    }),
    // toEventRequest は既定で PUBLISHED を載せる。下書き保存では明示的に上書きする。
    status: "DRAFT",
    ...overrides,
  };
}

function filledForm(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "忘年会",
    schedules: [
      {
        ...createScheduleDraft(),
        eventDate: "2026-12-05",
        startTime: "18:00",
        endTime: "20:00",
      },
    ],
    pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000" })],
    venueName: "渋谷ホール",
    ...overrides,
  };
}

/**
 * 下書きは「公開前の下書きを残す」ためのもの。
 * 定員・申し込み期限・チラシは公開までに埋めればよいので、保存では要求しない。
 */
describe("下書きの入力条件", () => {
  it("催し名・日時・費用プラン・場所だけで保存できる", () => {
    const parsed = SaveEventDraftSchema.parse(draftPayload());
    expect(parsed.title).toBe("下書きの催し");
    expect(parsed.status).toBe("DRAFT");
    // 定員・期限・チラシは空のまま保存できる（公開までに埋めればよい）。
    expect(parsed.capacity).toBeNull();
    expect(parsed.rsvpDeadline).toBeNull();
    expect(parsed.flyerAssetId).toBeNull();
  });

  it("費用プランが無いと保存できない", () => {
    const result = SaveEventDraftSchema.safeParse(draftPayload({ pricePlans: [] }));
    expect(result.success).toBe(false);
  });

  it("開催日時が無いと保存できない", () => {
    const result = SaveEventDraftSchema.safeParse(draftPayload({ schedules: [] }));
    expect(result.success).toBe(false);
  });

  it("会場名も従来の場所も無いと保存できない", () => {
    expect(SaveEventDraftSchema.safeParse(draftPayload({ venueName: null })).success).toBe(false);
    expect(
      SaveEventDraftSchema.safeParse(draftPayload({ venueName: null, location: "渋谷のどこか" })).success,
    ).toBe(true);
  });

  it("チラシ回数の下書きキーは任意で、UUID だけを受け付ける", () => {
    expect(SaveEventDraftSchema.safeParse(draftPayload()).success).toBe(true);
    expect(SaveEventDraftSchema.safeParse(draftPayload({ flyerDraftKey: null })).success).toBe(true);
    expect(
      SaveEventDraftSchema.safeParse(
        draftPayload({ flyerDraftKey: "11111111-1111-4111-8111-111111111111" }),
      ).success,
    ).toBe(true);
    expect(SaveEventDraftSchema.safeParse(draftPayload({ flyerDraftKey: "new" })).success).toBe(false);
  });
});

describe("下書き保存の入口", () => {
  it("DRAFT と未指定は通す", () => {
    expect(() => assertDraftSaveStatus(undefined)).not.toThrow();
    expect(() => assertDraftSaveStatus("DRAFT")).not.toThrow();
  });

  it("保存ついでに公開・停止へ変える要求は 400 で断る", () => {
    for (const status of ["PUBLISHED", "CLOSED"]) {
      try {
        assertDraftSaveStatus(status);
        throw new Error("例外が出ませんでした");
      } catch (error) {
        expect(error).toBeInstanceOf(ProblemDetailException);
        const problem = error as ProblemDetailException;
        expect(problem.status).toBe(400);
        expect(problem.extras.error).toBe("STATUS_CHANGE_NOT_ALLOWED");
      }
    }
  });
});

describe("下書き保存できるステップ", () => {
  it("空のフォームでは催しの名前と開催日時から直す", () => {
    expect(firstIncompleteDraftStep(EMPTY_EVENT_FORM)).toBe("basic");
    expect(isDraftReady(EMPTY_EVENT_FORM)).toBe(false);
  });

  it("費用プランが空なら費用プランを開く", () => {
    expect(firstIncompleteDraftStep(filledForm({ pricePlans: [] }))).toBe("pricing");
  });

  it("場所が空なら開催場所を開く", () => {
    expect(firstIncompleteDraftStep(filledForm({ venueName: "" }))).toBe("location");
  });

  it("定員・期限・チラシが空でも保存できる", () => {
    const form = filledForm({ capacity: null, rsvpDeadline: "", flyerAssetId: null });
    expect(firstIncompleteDraftStep(form)).toBeNull();
    expect(isDraftReady(form)).toBe(true);
  });

  it("下書きの再開位置は公開時と同じく、未入力の必須ステップ", () => {
    expect(resumeStepKey(filledForm({ pricePlans: [] }))).toBe("pricing");
    expect(resumeStepKey(filledForm())).toBe("capacity");
  });
});
