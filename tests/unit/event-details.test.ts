import { describe, expect, it } from "vitest";
import {
  composeEventTime,
  composeLocation,
  composePriceText,
  flyerPriceLabel,
  parseLegacyEventTime,
  parseLegacyPrice,
  priceLabel,
} from "@/lib/serializers";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertPricingEditable } from "@/modules/events/lib/pricing-mode";
import {
  createPricePlanDraft,
  groupNamesDiffer,
  groupPricePlanPairs,
  pricingModeOf,
  withCommonPricing,
  withGenderPricing,
  withGroupName,
} from "@/modules/events/types";

describe("parseLegacyEventTime", () => {
  it("チルダ区切りを開始と終了に分ける", () => {
    expect(parseLegacyEventTime("19:00〜21:30")).toEqual({ startTime: "19:00", endTime: "21:30" });
  });

  it("ハイフン・全角数字・全角コロンを受け付ける", () => {
    expect(parseLegacyEventTime("１９：００−２１：３０")).toEqual({
      startTime: "19:00",
      endTime: "21:30",
    });
  });

  it("1桁の時をゼロ埋めする", () => {
    expect(parseLegacyEventTime("9:00～11:00")).toEqual({ startTime: "09:00", endTime: "11:00" });
  });

  it("開始と終了が同じなら解釈しない", () => {
    expect(parseLegacyEventTime("19:00〜19:00")).toBeNull();
  });

  it("自由文は解釈しない", () => {
    expect(parseLegacyEventTime("19時頃から")).toBeNull();
  });
});

describe("composeEventTime", () => {
  it("通常の時間帯を合成する", () => {
    expect(composeEventTime("19:00", "21:30")).toBe("19:00〜21:30");
  });

  it("終了が開始より前なら翌日として扱う", () => {
    expect(composeEventTime("22:00", "02:00")).toBe("22:00〜翌02:00");
  });

  it("開始・終了が無ければ移行前の文字列を返す", () => {
    expect(composeEventTime(null, null, "19:00-21:30")).toBe("19:00-21:30");
  });
});

describe("parseLegacyPrice", () => {
  it("金額と補足を取り出す", () => {
    expect(parseLegacyPrice("3,000円（1ドリンク付）")).toEqual({ amount: 3000, note: "1ドリンク付" });
  });

  it("無料は0円として扱う", () => {
    expect(parseLegacyPrice("無料")).toEqual({ amount: 0, note: null });
  });

  it("数字が無ければ0円にする", () => {
    expect(parseLegacyPrice("応相談")).toEqual({ amount: 0, note: null });
  });
});

describe("composePriceText", () => {
  it("0円は無料と表示する", () => {
    expect(composePriceText({ amount: 0, note: null })).toBe("無料");
  });

  it("補足を括弧で付ける", () => {
    expect(composePriceText({ amount: 3000, note: "1ドリンク付" })).toBe("3,000円（1ドリンク付）");
  });
});

describe("composeLocation", () => {
  it("会場名と住所を結合する", () => {
    expect(
      composeLocation({
        venueName: "○○ホール",
        prefecture: "東京都",
        city: "渋谷区",
        town: "神宮前",
        addressLine: "1-2-3",
        building: "○○ビル3F",
      }),
    ).toBe("○○ホール 東京都渋谷区神宮前1-2-3 ○○ビル3F");
  });

  it("構造化住所が無ければ従来の場所を返す", () => {
    expect(composeLocation({ location: "渋谷のバー", venueName: "" })).toBe("渋谷のバー");
  });
});

describe("priceLabel", () => {
  it("対象と金額を並べる", () => {
    expect(
      priceLabel([
        { name: "一般", audience: "MALE", price: "3,000円" },
        { name: "一般", audience: "FEMALE", price: "2,500円" },
      ]),
    ).toBe("男性 一般 3,000円 / 女性 一般 2,500円");
  });
});

describe("flyerPriceLabel", () => {
  it("男女別の金額を30文字以内に収める", () => {
    const label = flyerPriceLabel([
      { name: "一般", audience: "MALE", amount: 3000, note: null },
      { name: "一般", audience: "FEMALE", amount: 2500, note: null },
    ]);
    expect(label).toBe("男性3,000円 / 女性2,500円");
    expect(label.length).toBeLessThanOrEqual(30);
  });

  it("単一プランは補足も含める", () => {
    expect(flyerPriceLabel([{ name: "一般", audience: "ANY", amount: 3000, note: "1ドリンク付" }])).toBe(
      "3,000円（1ドリンク付）",
    );
  });
});

describe("pricingModeOf", () => {
  it("すべて共通なら COMMON", () => {
    expect(pricingModeOf([{ audience: "ANY" }, { audience: "ANY" }])).toBe("COMMON");
  });

  it("男性用・女性用があれば GENDER", () => {
    expect(pricingModeOf([{ audience: "MALE" }, { audience: "FEMALE" }])).toBe("GENDER");
  });
});

describe("withGenderPricing", () => {
  it("共通プランを男性用と女性用に展開する", () => {
    const plan = createPricePlanDraft({ id: "plan-1", name: "一般", amount: "3000" });
    const result = withGenderPricing([plan]);
    expect(result.map((row) => row.audience)).toEqual(["MALE", "FEMALE"]);
    expect(result[0].id).toBe("plan-1");
    expect(result[1].id).toBeUndefined();
    expect(result.every((row) => row.name === "一般" && row.amount === "3000")).toBe(true);
  });

  it("すでに男女別の行は増やさない", () => {
    const plans = [
      createPricePlanDraft({ audience: "MALE", name: "一般", amount: "3000" }),
      createPricePlanDraft({ audience: "FEMALE", name: "一般", amount: "2500" }),
    ];
    expect(withGenderPricing(plans)).toHaveLength(2);
  });

  it("組の途中では切らず、上限8件で打ち切る", () => {
    const plans = Array.from({ length: 5 }, (_, index) =>
      createPricePlanDraft({ name: `プラン${index}`, amount: "3000" }),
    );
    const result = withGenderPricing(plans);
    expect(result).toHaveLength(8);
    expect(result.map((row) => row.audience)).toEqual([
      "MALE",
      "FEMALE",
      "MALE",
      "FEMALE",
      "MALE",
      "FEMALE",
      "MALE",
      "FEMALE",
    ]);
  });

  it("共通が混ざっていても共通の行だけをペアへ展開する", () => {
    const plans = [
      createPricePlanDraft({ audience: "ANY", name: "一般", amount: "3000" }),
      createPricePlanDraft({ audience: "MALE", name: "学生", amount: "2000" }),
    ];
    const result = withGenderPricing(plans);
    expect(result.map((row) => `${row.audience}:${row.name}`)).toEqual([
      "MALE:一般",
      "FEMALE:一般",
      "MALE:学生",
    ]);
  });

  it("同じ対象・同じプラン名になる組は落として一意制約に当てない", () => {
    const plans = [
      createPricePlanDraft({ audience: "ANY", name: "一般", amount: "3000" }),
      createPricePlanDraft({ audience: "MALE", name: "一般", amount: "3000" }),
      createPricePlanDraft({ audience: "FEMALE", name: "一般", amount: "3000" }),
    ];
    const result = withGenderPricing(plans);
    expect(result.map((row) => `${row.audience}:${row.name}`)).toEqual([
      "MALE:一般",
      "FEMALE:一般",
    ]);
  });
});

describe("groupPricePlanPairs", () => {
  it("隣り合う男性用と女性用を1組にする", () => {
    const plans = [
      { key: "a", audience: "MALE" as const },
      { key: "b", audience: "FEMALE" as const },
      { key: "c", audience: "MALE" as const },
      { key: "d", audience: "FEMALE" as const },
    ];
    expect(groupPricePlanPairs(plans).map((group) => group.map((row) => row.key))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("共通の行は1行で1組にする", () => {
    const plans = [
      { key: "a", audience: "ANY" as const },
      { key: "b", audience: "ANY" as const },
    ];
    expect(groupPricePlanPairs(plans).map((group) => group.map((row) => row.key))).toEqual([
      ["a"],
      ["b"],
    ]);
  });

  it("相手がいない行は1行で1組にする", () => {
    const plans = [
      { key: "a", audience: "MALE" as const },
      { key: "b", audience: "MALE" as const },
      { key: "c", audience: "FEMALE" as const },
    ];
    expect(groupPricePlanPairs(plans).map((group) => group.map((row) => row.key))).toEqual([
      ["a"],
      ["b", "c"],
    ]);
  });
});

describe("withGroupName", () => {
  it("組の男女両方へ同じプラン名を入れる", () => {
    const plans = [
      createPricePlanDraft({ key: "male", audience: "MALE", name: "", amount: "3000" }),
      createPricePlanDraft({ key: "female", audience: "FEMALE", name: "", amount: "2500" }),
      createPricePlanDraft({ key: "other-male", audience: "MALE", name: "学生", amount: "2000" }),
      createPricePlanDraft({ key: "other-female", audience: "FEMALE", name: "学生", amount: "1500" }),
    ];
    const group = groupPricePlanPairs(plans)[0];
    const result = withGroupName(plans, group, "一般");
    expect(result.map((row) => `${row.key}:${row.name}`)).toEqual([
      "male:一般",
      "female:一般",
      "other-male:学生",
      "other-female:学生",
    ]);
    // 金額は行ごとに残す。
    expect(result.map((row) => row.amount)).toEqual(["3000", "2500", "2000", "1500"]);
  });

  it("元の配列を書き換えない", () => {
    const plans = [createPricePlanDraft({ key: "male", audience: "MALE", name: "" })];
    withGroupName(plans, plans, "一般");
    expect(plans[0].name).toBe("");
  });
});

describe("groupNamesDiffer", () => {
  it("組の中でプラン名が揃っていれば false", () => {
    const plans = [
      createPricePlanDraft({ key: "male", audience: "MALE", name: "一般" }),
      createPricePlanDraft({ key: "female", audience: "FEMALE", name: "一般" }),
    ];
    expect(groupNamesDiffer(plans)).toBe(false);
  });

  it("組の中でプラン名がずれていれば true", () => {
    const plans = [
      createPricePlanDraft({ key: "male", audience: "MALE", name: "一般" }),
      createPricePlanDraft({ key: "female", audience: "FEMALE", name: "学生" }),
    ];
    expect(groupNamesDiffer(plans)).toBe(true);
  });

  it("1行だけの組は比較しない", () => {
    expect(groupNamesDiffer([createPricePlanDraft({ audience: "ANY", name: "一般" })])).toBe(false);
  });
});

describe("withCommonPricing", () => {
  it("男性用を共通に戻し、女性用を落とす", () => {
    const plans = [
      createPricePlanDraft({ id: "male-1", audience: "MALE", name: "一般", amount: "3000" }),
      createPricePlanDraft({ id: "female-1", audience: "FEMALE", name: "一般", amount: "2500" }),
    ];
    const result = withCommonPricing(plans);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "male-1", audience: "ANY", name: "一般" });
  });

  it("共通へ寄せて同名が重複するときは先の行を残す", () => {
    const plans = [
      createPricePlanDraft({ id: "any-1", audience: "ANY", name: "一般", amount: "3000" }),
      createPricePlanDraft({ id: "male-1", audience: "MALE", name: "一般", amount: "3500" }),
    ];
    const result = withCommonPricing(plans);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "any-1", audience: "ANY", amount: "3000" });
  });
});

describe("assertPricingEditable", () => {
  const published = (
    participants: { status: "ATTENDING" | "DECLINED"; pricePlanId: string | null }[],
  ) => ({
    status: "PUBLISHED" as const,
    participants,
    pricePlans: [
      { id: "male-1", audience: "MALE" as const },
      { id: "female-1", audience: "FEMALE" as const },
    ],
  });

  it("下書きは常に編集できる", () => {
    expect(() =>
      assertPricingEditable(
        { ...published([{ status: "ATTENDING", pricePlanId: "female-1" }]), status: "DRAFT" },
        { pricePlans: [{ id: "male-1", audience: "ANY" }] },
      ),
    ).not.toThrow();
  });

  it("出席者がいなければ切り替えられる", () => {
    expect(() =>
      assertPricingEditable(published([{ status: "DECLINED", pricePlanId: null }]), {
        pricePlans: [{ id: "male-1", audience: "ANY" }],
      }),
    ).not.toThrow();
  });

  it("出席者がいると共通料金へ切り替えられない", () => {
    expect(() =>
      assertPricingEditable(published([{ status: "ATTENDING", pricePlanId: "male-1" }]), {
        pricePlans: [{ id: "male-1", audience: "ANY" }],
      }),
    ).toThrowError(ProblemDetailException);
  });

  it("出席者が選んだプランの削除は止める", () => {
    expect(() =>
      assertPricingEditable(published([{ status: "ATTENDING", pricePlanId: "female-1" }]), {
        pricePlans: [{ id: "male-1", audience: "MALE" }],
      }),
    ).toThrowError(/PRICING_LOCKED|料金/);
  });

  it("金額だけの変更は通す", () => {
    expect(() =>
      assertPricingEditable(published([{ status: "ATTENDING", pricePlanId: "female-1" }]), {
        pricePlans: [
          { id: "male-1", audience: "MALE" },
          { id: "female-1", audience: "FEMALE" },
        ],
      }),
    ).not.toThrow();
  });
});
