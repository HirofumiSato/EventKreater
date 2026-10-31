import { describe, expect, it } from "vitest";
import {
  composeDiscountText,
  serializeDiscounts,
  serializeParticipantDiscounts,
} from "@/lib/serializers";
import { discountTotal, payableAmount } from "@/modules/revenue/lib/revenue";
import { keepDiscountSnapshot } from "@/modules/events/lib/events";
import { draftsFromOptions, createDiscountDraft } from "@/modules/events/types";

/**
 * 割引は「条件名＋値引き額（円）＋補足」の組。すべての費用プランから引き、支払額は 0 円で止める。
 * 申込時点の写し（スナップショット）を残すので、定義を編集・削除しても金額は動かない。
 */
describe("composeDiscountText", () => {
  it("条件名と値引き額を 1 行にする", () => {
    expect(composeDiscountText({ name: "友達と参加", amount: 500 })).toBe("友達と参加 500円引き");
  });

  it("補足は括弧で添える", () => {
    expect(
      composeDiscountText({ name: "友達と参加", amount: 500, note: "2人以上のとき" }),
    ).toBe("友達と参加 500円引き（2人以上のとき）");
  });

  it("0 円の割引は値引きを付けず、名前だけを返す", () => {
    expect(composeDiscountText({ name: "早割", amount: 0 })).toBe("早割");
  });
});

describe("serializeDiscounts", () => {
  it("入力順（sortOrder）に並べ、表示用の label を付ける", () => {
    const rows = serializeDiscounts([
      { id: "b", name: "学生", amount: 300, note: null, sortOrder: 1 },
      { id: "a", name: "友達と参加", amount: 500, note: "2人以上のとき", sortOrder: 0 },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows[0].label).toBe("友達と参加 500円引き（2人以上のとき）");
  });

  it("0 件は空配列", () => {
    expect(serializeDiscounts([])).toEqual([]);
  });
});

describe("serializeParticipantDiscounts", () => {
  it("定義が消えて discountId が null でも、写しをそのまま返す", () => {
    const rows = serializeParticipantDiscounts([
      { discountId: null, name: "友達と参加", amount: 500, note: "2人以上のとき", sortOrder: 0 },
    ]);
    expect(rows).toEqual([
      {
        discountId: null,
        name: "友達と参加",
        amount: 500,
        note: "2人以上のとき",
        label: "友達と参加 500円引き（2人以上のとき）",
      },
    ]);
  });
});

describe("discountTotal と payableAmount", () => {
  it("割引が無ければ合計は 0、支払額はプラン金額のまま", () => {
    expect(discountTotal([])).toBe(0);
    expect(payableAmount({ priceAmount: 3000, discounts: [] })).toBe(3000);
    expect(payableAmount({ priceAmount: 3000 })).toBe(3000);
  });

  it("複数の割引を足して引く", () => {
    const discounts = [{ amount: 500 }, { amount: 300 }];
    expect(discountTotal(discounts)).toBe(800);
    expect(payableAmount({ priceAmount: 3000, discounts })).toBe(2200);
  });

  it("支払額は 0 円で止める", () => {
    expect(payableAmount({ priceAmount: 300, discounts: [{ amount: 500 }] })).toBe(0);
  });

  it("プラン未選択（null）は null のまま", () => {
    expect(payableAmount({ priceAmount: null, discounts: [{ amount: 500 }] })).toBeNull();
  });
});

describe("keepDiscountSnapshot", () => {
  it("同じ割引を選び直しているだけなら、申込時点の金額を保つ", () => {
    const kept = keepDiscountSnapshot(
      [{ discountId: "a", name: "友達と参加", amount: 500, note: null }],
      [{ discountId: "a", name: "友達と参加（改定）", amount: 800, note: null }],
    );
    expect(kept).toEqual([{ discountId: "a", name: "友達と参加", amount: 500, note: null }]);
  });

  it("新しく選んだ割引は、いまの定義の金額を写す", () => {
    const kept = keepDiscountSnapshot(
      [{ discountId: "a", name: "友達と参加", amount: 500, note: null }],
      [{ discountId: "a", name: "友達と参加", amount: 500, note: null }],
    );
    // 変化が無ければそのまま（同じ内容でも新しい配列を返す）。
    expect(kept).toEqual([{ discountId: "a", name: "友達と参加", amount: 500, note: null }]);
    expect(
      keepDiscountSnapshot([], [{ discountId: "b", name: "学生", amount: 300, note: null }]),
    ).toEqual([{ discountId: "b", name: "学生", amount: 300, note: null }]);
  });

  it("外した割引は落とす", () => {
    expect(
      keepDiscountSnapshot(
        [{ discountId: "a", name: "友達と参加", amount: 500, note: null }],
        [],
      ),
    ).toEqual([]);
  });
});

describe("draftsFromOptions", () => {
  it("保存済みの割引を入力行へ戻す", () => {
    const drafts = draftsFromOptions({
      schedules: [],
      pricePlans: [],
      discounts: [
        { id: "a", name: "友達と参加", amount: 500, note: "2人以上のとき", label: "" },
      ],
    });
    expect(drafts.discounts).toEqual([
      expect.objectContaining({ id: "a", name: "友達と参加", amount: "500", note: "2人以上のとき" }),
    ]);
  });

  it("割引が無ければ空配列（行を足さない）", () => {
    expect(draftsFromOptions({ schedules: [], pricePlans: [] }).discounts).toEqual([]);
  });
});

describe("createDiscountDraft", () => {
  it("省略した項目は空文字で作る", () => {
    const row = createDiscountDraft();
    expect(row.name).toBe("");
    expect(row.amount).toBe("");
    expect(row.note).toBe("");
  });
});
