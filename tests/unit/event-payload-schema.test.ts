import { describe, expect, it } from "vitest";
import { CreateEventSchema } from "@/lib/schemas";
import {
  createDiscountDraft,
  createPricePlanDraft,
  EMPTY_EVENT_FORM,
  MAX_EVENT_OPTIONS,
  toEventRequest,
} from "@/modules/events/types";

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

  it("公開状態の指定が無ければ即公開として扱う", () => {
    const { status: _status, ...withoutStatus } = toEventRequest(form);
    expect(CreateEventSchema.parse(withoutStatus).status).toBe("PUBLISHED");
  });

  it("下書きの指定を落とさずに受理する", () => {
    expect(CreateEventSchema.parse({ ...toEventRequest(form), status: "DRAFT" }).status).toBe("DRAFT");
  });

  it("公開・下書き以外の状態は受け付けない", () => {
    expect(CreateEventSchema.safeParse({ ...toEventRequest(form), status: "CLOSED" }).success).toBe(false);
  });
});

describe("割引の送信形", () => {
  const base = {
    ...EMPTY_EVENT_FORM,
    title: "割引テスト",
    schedules: [
      {
        ...EMPTY_EVENT_FORM.schedules[0],
        eventDate: "2026-11-20",
        startTime: "19:00",
        endTime: "21:00",
      },
    ],
    pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000" })],
    venueName: "テスト会場",
  };

  it("割引 0 件は空配列で通り、省略したクライアントも 0 件になる", () => {
    const payload = toEventRequest(base);
    expect(payload.discounts).toEqual([]);
    expect(CreateEventSchema.parse(payload).discounts).toEqual([]);
    // 割引を足す前のクライアント（フィールドごと省略）も壊さない。
    const { discounts: _discounts, ...withoutDiscounts } = payload;
    expect(CreateEventSchema.parse(withoutDiscounts).discounts).toEqual([]);
  });

  it("複数件の割引をそのまま通す", () => {
    const payload = toEventRequest({
      ...base,
      discounts: [
        createDiscountDraft({ name: "友達と参加", amount: "500", note: "2人以上のとき" }),
        createDiscountDraft({ name: "学生", amount: "300", note: "" }),
      ],
    });
    const parsed = CreateEventSchema.parse(payload);
    expect(parsed.discounts).toEqual([
      { name: "友達と参加", amount: 500, note: "2人以上のとき" },
      { name: "学生", amount: 300, note: null },
    ]);
  });

  it("上限（8件）を超える割引は受け付けない", () => {
    const payload = toEventRequest({
      ...base,
      discounts: Array.from({ length: MAX_EVENT_OPTIONS + 1 }, (_, index) =>
        createDiscountDraft({ name: `割引${index}`, amount: "100" }),
      ),
    });
    expect(CreateEventSchema.safeParse(payload).success).toBe(false);
  });

  it("同じ名前の割引は重複で落ちる", () => {
    const payload = toEventRequest({
      ...base,
      discounts: [
        createDiscountDraft({ name: "友達と参加", amount: "500" }),
        createDiscountDraft({ name: "友達と参加", amount: "300" }),
      ],
    });
    const result = CreateEventSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === "同じ名前の割引は重複できません")).toBe(true);
    }
  });

  it("名前も金額も補足も空の行は送らない", () => {
    const payload = toEventRequest({
      ...base,
      discounts: [createDiscountDraft({ name: "", amount: "", note: "" })],
    });
    expect(payload.discounts).toEqual([]);
    expect(CreateEventSchema.safeParse(payload).success).toBe(true);
  });

  it("名前だけ入れて金額が空の行は 0 円として送り、スキーマで落ちる", () => {
    const payload = toEventRequest({
      ...base,
      discounts: [createDiscountDraft({ name: "友達と参加", amount: "" })],
    });
    expect(payload.discounts).toEqual([{ name: "友達と参加", amount: 0, note: null }]);
    expect(CreateEventSchema.safeParse(payload).success).toBe(false);
  });
});
