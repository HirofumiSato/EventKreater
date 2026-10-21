import { describe, expect, it } from "vitest";
import { CreateEventSchema } from "@/lib/schemas";
import { createPricePlanDraft, EMPTY_EVENT_FORM, toEventRequest } from "@/modules/events/types";

/**
 * 画面のフォーム値をAPIへ送る形にしたとき、サーバー側のスキーマで必ず通ることを確かめる。
 * 空欄を null で送る項目（補足・住所）は、undefined しか許さないと保存が 400 になる。
 */
describe("toEventRequest と CreateEventSchema の往復", () => {
  const form = {
    ...EMPTY_EVENT_FORM,
    title: "男女別テスト",
    schedules: [
      {
        ...EMPTY_EVENT_FORM.schedules[0],
        eventDate: "2026-11-20",
        startTime: "19:00",
        endTime: "21:00",
      },
    ],
    pricePlans: [
      createPricePlanDraft({ audience: "MALE", name: "一般", amount: "3000" }),
      createPricePlanDraft({ audience: "FEMALE", name: "一般", amount: "2500" }),
    ],
    venueName: "テスト会場",
  };

  it("補足が空でも保存できる形（null）で通る", () => {
    const payload = toEventRequest(form);
    expect(payload.pricePlans.map((row) => row.note)).toEqual([null, null]);
    expect(CreateEventSchema.safeParse(payload).success).toBe(true);
  });

  it("郵便番号と住所の任意項目が空でも通る", () => {
    const payload = toEventRequest({
      ...form,
      prefecture: "東京都",
      city: "渋谷区",
      addressLine: "1-2-3",
    });
    expect(payload).toMatchObject({ postalCode: null, town: null, building: null });
    expect(CreateEventSchema.safeParse(payload).success).toBe(true);
  });
});
