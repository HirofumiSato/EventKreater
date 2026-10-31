import { describe, expect, it } from "vitest";
import { countPublishedBySource } from "@/modules/events/lib/published-counts";
import type { PublishedCountRow } from "@/modules/events/lib/published-counts";

const TODAY = "2026-10-31";

function row(overrides: Partial<PublishedCountRow> = {}): PublishedCountRow {
  return {
    status: "PUBLISHED",
    role: "OWNER",
    quotaSource: "SUBSCRIPTION",
    schedules: [{ eventDate: "2026-11-08" }],
    ...overrides,
  };
}

describe("マイページの公開中の件数", () => {
  it("月額プランとチケット（単発・無料枠）に分ける", () => {
    const counts = countPublishedBySource(
      [
        row(),
        row({ quotaSource: "SUBSCRIPTION" }),
        row({ quotaSource: "PAID_CREDIT" }),
        row({ quotaSource: "FREE_TRIAL" }),
      ],
      TODAY,
    );
    expect(counts).toEqual({ plan: 2, ticket: 2 });
  });

  it("帯と同じく、公開中・今日以降・自分の筆頭幹事のものだけを数える", () => {
    const counts = countPublishedBySource(
      [
        row({ status: "CLOSED" }),
        row({ status: "DRAFT", quotaSource: null }),
        row({ role: "CO_HOST" }),
        row({ schedules: [{ eventDate: "2026-10-30" }] }),
        row({ schedules: [{ eventDate: "2026-10-01" }, { eventDate: "2026-11-01" }] }),
      ],
      TODAY,
    );
    // 受付停止・下書き・共同主催・開催日が過ぎたものは数えない。
    // 複数日程のどれかが今日以降なら数える。
    expect(counts).toEqual({ plan: 1, ticket: 0 });
  });

  it("枠が記録されていない移行前の催しはチケット側に置く", () => {
    expect(countPublishedBySource([row({ quotaSource: null })], TODAY)).toEqual({
      plan: 0,
      ticket: 1,
    });
  });

  it("0 件なら両方 0", () => {
    expect(countPublishedBySource([], TODAY)).toEqual({ plan: 0, ticket: 0 });
  });
});
