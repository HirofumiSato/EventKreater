import { describe, expect, it } from "vitest";
import {
  EMPTY_EVENT_FORM,
  createPricePlanDraft,
  createScheduleDraft,
  toEventRequest,
  type EventFormValues,
} from "@/modules/events/types";
import { eventFormToPreview } from "@/modules/events/lib/preview";
import { buildFlyerFormPayload } from "@/modules/flyers/lib/form";
import { toFlyerPayload } from "@/modules/flyers/lib/flyer";

function form(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "ジャズの夜",
    schedules: [
      createScheduleDraft({ key: "s1", eventDate: "2026-11-15", startTime: "19:00", endTime: "22:00" }),
    ],
    pricePlans: [createPricePlanDraft({ key: "p1", name: "一般", amount: "3000", note: "1ドリンク付" })],
    venueName: "Jazz Bar MOON",
    prefecture: "東京都",
    city: "渋谷区",
    addressLine: "1-2-3",
    ...overrides,
  };
}

describe("対象世代とテーマの送信", () => {
  it("入力した対象世代とテーマをそのまま送る", () => {
    const request = toEventRequest(form({ targetGeneration: "20代から40代", themeId: "neon" }));
    expect(request.targetGeneration).toBe("20代から40代");
    expect(request.themeId).toBe("neon");
  });

  it("対象世代の前後の空白は落とし、空欄は null にする", () => {
    expect(toEventRequest(form({ targetGeneration: "  20代から40代  " })).targetGeneration).toBe(
      "20代から40代",
    );
    expect(toEventRequest(form({ targetGeneration: "   " })).targetGeneration).toBeNull();
  });

  it("テーマ未選択は null（標準の見た目）", () => {
    expect(toEventRequest(form()).themeId).toBeNull();
  });
});

describe("eventFormToPreview", () => {
  it("入力済みの値を告知ページの形へ寄せる", () => {
    const preview = eventFormToPreview(form({ targetGeneration: "20代から40代", capacity: 20 }));
    expect(preview.title).toBe("ジャズの夜");
    expect(preview.schedules[0]?.eventTime).toBe("19:00〜22:00");
    expect(preview.pricePlans[0]?.price).toBe("3,000円（1ドリンク付）");
    expect(preview.location).toContain("Jazz Bar MOON");
    expect(preview.targetGeneration).toBe("20代から40代");
    expect(preview.capacity).toBe(20);
  });

  it("未入力の欄は「未入力」と出し、空欄のままにしない", () => {
    const preview = eventFormToPreview({ ...EMPTY_EVENT_FORM });
    expect(preview.title).toBe("（催しの名前は未入力）");
    expect(preview.schedules[0]?.eventTime).toBe("時刻未入力");
    expect(preview.pricePlans[0]?.price).toBe("金額未入力");
    expect(preview.location).toBe("場所未定");
    expect(preview.targetGeneration).toBeNull();
  });

  it("チラシがあればプレビューの画像として包む", () => {
    const preview = eventFormToPreview(form({ themeId: "parchment" }), "/flyer.jpg");
    expect(preview.flyerAsset?.imageUrl).toBe("/flyer.jpg");
    expect(preview.status).toBe("DRAFT");
  });

  it("チラシが無ければ null", () => {
    expect(eventFormToPreview(form()).flyerAsset).toBeNull();
  });
});

describe("チラシ生成へテーマを渡す", () => {
  it("buildFlyerFormPayload はフォームのテーマを写す", () => {
    expect(buildFlyerFormPayload(form({ themeId: "neo-brutalism" })).themeId).toBe("neo-brutalism");
    expect(buildFlyerFormPayload(form()).themeId).toBeNull();
  });

  it("toFlyerPayload はサービスのスネークケースへ寄せる", () => {
    const payload = toFlyerPayload({
      ...buildFlyerFormPayload(form({ themeId: "neon" })),
      templateId: "style_1_bar_stylish",
      layoutId: "classic",
    });
    expect(payload.semantic_theme).toBe("neon");
    expect(payload.template_id).toBe("style_1_bar_stylish");
  });

  it("テーマ未選択は null で送る（サービスの既定と同じ）", () => {
    const payload = toFlyerPayload({
      ...buildFlyerFormPayload(form()),
      templateId: "style_2_warm_earth",
      layoutId: "classic",
    });
    expect(payload.semantic_theme).toBeNull();
  });
});
