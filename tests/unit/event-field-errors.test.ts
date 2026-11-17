import { describe, expect, it } from "vitest";
import {
  eventFieldErrors,
  stepOfField,
} from "@/modules/events/lib/field-errors";
import {
  EMPTY_EVENT_FORM,
  createPricePlanDraft,
  createScheduleDraft,
  type EventFormValues,
} from "@/modules/events/types";

/** 必須がすべて埋まった状態。各テストはここから 1 か所だけ崩す。 */
function filledForm(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "秋の芋煮会",
    schedules: [
      createScheduleDraft({
        key: "schedule-1",
        eventDate: "2026-11-23",
        startTime: "11:00",
        endTime: "15:00",
      }),
    ],
    pricePlans: [createPricePlanDraft({ key: "plan-1", name: "一般", amount: "3000" })],
    venueName: "河川敷公園",
    ...overrides,
  };
}

const EMPTY = { capacitySelection: "" } as const;

describe("欄ごとのエラー", () => {
  it("埋まったフォームでは何も返さない", () => {
    expect(eventFieldErrors(filledForm(), EMPTY)).toEqual({});
  });

  it("イベント名と日時の 3 欄を、それぞれの欄の id で返す", () => {
    const errors = eventFieldErrors(
      filledForm({
        title: "  ",
        schedules: [
          createScheduleDraft({ key: "schedule-1", eventDate: "", startTime: "", endTime: "" }),
        ],
      }),
      EMPTY,
    );

    expect(errors["event-title"]).toBe("イベント名を入れてください。");
    expect(errors["schedule-date-schedule-1"]).toBe("開催日を入れてください。");
    expect(errors["schedule-start-schedule-1"]).toBe("開始時刻を入れてください。");
    expect(errors["schedule-end-schedule-1"]).toBe("終了時刻を入れてください。");
  });

  it("金額が空なら入れてください、整数でなければ整数でと返す", () => {
    const empty = eventFieldErrors(
      filledForm({
        pricePlans: [createPricePlanDraft({ key: "plan-1", name: "一般", amount: "" })],
      }),
      EMPTY,
    );
    expect(empty["plan-amount-plan-1"]).toBe("金額を入れてください。");

    const decimal = eventFieldErrors(
      filledForm({
        pricePlans: [createPricePlanDraft({ key: "plan-1", name: "一般", amount: "1.5" })],
      }),
      EMPTY,
    );
    expect(decimal["plan-amount-plan-1"]).toBe("金額は0以上の整数で入れてください。");
  });

  it("プラン名が空なら、その行の id で返す", () => {
    const errors = eventFieldErrors(
      filledForm({
        pricePlans: [createPricePlanDraft({ key: "plan-1", name: " ", amount: "3000" })],
      }),
      EMPTY,
    );
    expect(errors["plan-name-plan-1"]).toBe("プラン名を入れてください。");
  });

  it("住所を入れ始めたら、都道府県・市区町村・番地の不足を言う", () => {
    const errors = eventFieldErrors(filledForm({ city: "渋谷区" }), EMPTY);

    expect(errors["event-prefecture"]).toBe("都道府県を入れてください。");
    expect(errors["event-city"]).toBeUndefined();
    expect(errors["event-address-line"]).toBe("番地を入れてください。");
    expect(errors["event-venue-name"]).toBeUndefined();
  });

  it("住所も会場名も無ければ、会場名の不足だけを言う", () => {
    const errors = eventFieldErrors(filledForm({ venueName: "" }), EMPTY);
    expect(errors["event-venue-name"]).toBe("会場名を入れてください。");
    expect(errors["event-prefecture"]).toBeUndefined();
  });

  it("概要が上限を超えたら、概要の欄で返す", () => {
    const errors = eventFieldErrors(filledForm({ summary: "あ".repeat(1001) }), EMPTY);
    expect(errors["event-summary"]).toBe("イベント概要は1000文字以内にしてください。");
  });

  it("「51以上」を選んで空なら、人数の欄で返す", () => {
    const errors = eventFieldErrors(filledForm({ capacity: null }), {
      capacitySelection: "custom",
    });
    expect(errors["event-capacity-custom"]).toBe("51人以上の人数を入れてください。");
  });
});

describe("欄からステップを引く", () => {
  it("欄の id の先頭で、開くステップを決める", () => {
    expect(stepOfField("event-title")).toBe("basic");
    expect(stepOfField("schedule-date-abc")).toBe("basic");
    expect(stepOfField("plan-amount-abc")).toBe("pricing");
    expect(stepOfField("event-prefecture")).toBe("location");
    expect(stepOfField("event-address-line")).toBe("location");
    expect(stepOfField("event-capacity-custom")).toBe("capacity");
  });
});
