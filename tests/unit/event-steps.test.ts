import { describe, expect, it } from "vitest";
import {
  EVENT_STEPS,
  firstIncompleteMandatoryStep,
  formatShortDate,
  formatShortDeadline,
  isBasicStepComplete,
  isCapacityStepComplete,
  isFlyerStepComplete,
  isLocationStepComplete,
  isPricingStepComplete,
  resumeStepKey,
  summarizeStep,
} from "@/modules/events/lib/steps";
import {
  EMPTY_EVENT_FORM,
  createPricePlanDraft,
  createScheduleDraft,
  type EventFormValues,
} from "@/modules/events/types";

/** すべての必須項目が埋まった状態。各テストはここから 1 か所だけ崩す。 */
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

describe("ステップの並び", () => {
  it("入力の順に5ステップを並べ、最初の3つを必須にする", () => {
    expect(EVENT_STEPS.map((step) => step.key)).toEqual([
      "basic",
      "pricing",
      "location",
      "capacity",
      "flyer",
    ]);
    expect(EVENT_STEPS.filter((step) => step.mandatory).map((step) => step.key)).toEqual([
      "basic",
      "pricing",
      "location",
    ]);
  });
});

describe("ステップ1（催しの名前と開催日時）", () => {
  it("空のフォームでは未完了", () => {
    expect(isBasicStepComplete(EMPTY_EVENT_FORM)).toBe(false);
  });

  it("名前だけでは未完了（開催日時が要る）", () => {
    expect(isBasicStepComplete({ ...EMPTY_EVENT_FORM, title: "忘年会" })).toBe(false);
  });

  it("日付・開始・終了がそろうと完了", () => {
    expect(isBasicStepComplete(filledForm())).toBe(true);
  });

  it("2件目以降の日時が欠けていても完了にしない", () => {
    const form = filledForm({
      schedules: [
        ...filledForm().schedules,
        { ...createScheduleDraft(), eventDate: "2026-12-06", startTime: "18:00", endTime: "" },
      ],
    });
    expect(isBasicStepComplete(form)).toBe(false);
  });
});

describe("ステップ2（費用プラン）", () => {
  it("金額が空なら未完了", () => {
    const form = filledForm({
      pricePlans: [createPricePlanDraft({ name: "一般", amount: "" })],
    });
    expect(isPricingStepComplete(form)).toBe(false);
  });

  it("プラン名が空なら未完了", () => {
    const form = filledForm({ pricePlans: [createPricePlanDraft({ name: " ", amount: "3000" })] });
    expect(isPricingStepComplete(form)).toBe(false);
  });

  it("金額が整数でなければ未完了", () => {
    const form = filledForm({
      pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000.5" })],
    });
    expect(isPricingStepComplete(form)).toBe(false);
  });

  it("0円は無料として完了にする", () => {
    const form = filledForm({
      pricePlans: [createPricePlanDraft({ name: "招待", amount: "0" })],
    });
    expect(isPricingStepComplete(form)).toBe(true);
  });
});

describe("ステップ3（開催場所）", () => {
  it("会場名だけで完了する（オンライン開催を想定）", () => {
    expect(isLocationStepComplete(filledForm({ venueName: "オンライン" }))).toBe(true);
  });

  it("構造化住所を入れ始めたら都道府県・市区町村・番地まで要る", () => {
    const form = filledForm({ venueName: "", prefecture: "東京都", city: "渋谷区" });
    expect(isLocationStepComplete(form)).toBe(false);
    expect(isLocationStepComplete({ ...form, addressLine: "1-2-3" })).toBe(true);
  });

  it("会場名も住所も無ければ未完了", () => {
    expect(isLocationStepComplete(filledForm({ venueName: "" }))).toBe(false);
  });

  it("旧形式の場所だけでも完了にする", () => {
    expect(isLocationStepComplete(filledForm({ venueName: "", location: "渋谷のどこか" }))).toBe(
      true,
    );
  });
});

describe("ステップ4（定員と申し込み期限）", () => {
  it("無制限・期限なしでも次へ進める", () => {
    expect(isCapacityStepComplete(null, "")).toBe(true);
  });

  it("人数を選んでいれば進める", () => {
    expect(isCapacityStepComplete(30, "30")).toBe(true);
  });

  it("51以上を選んで人数が空なら進めない", () => {
    expect(isCapacityStepComplete(null, "custom")).toBe(false);
    expect(isCapacityStepComplete(120, "custom")).toBe(true);
  });
});

describe("ステップ5（チラシ生成）", () => {
  it("チラシを作らなくても公開できる", () => {
    expect(isFlyerStepComplete(filledForm(), true)).toBe(true);
  });

  it("チラシも「作らない」も無ければ未完了", () => {
    expect(isFlyerStepComplete(filledForm(), false)).toBe(false);
  });
});

describe("続きのステップ", () => {
  it("空のフォームでは催しの名前と開催日時から始める", () => {
    expect(firstIncompleteMandatoryStep(EMPTY_EVENT_FORM)).toBe("basic");
    expect(resumeStepKey(EMPTY_EVENT_FORM)).toBe("basic");
  });

  it("催しの名前と日時が済んでいれば費用プランから再開する", () => {
    const form = filledForm({ venueName: "" });
    expect(firstIncompleteMandatoryStep(form)).toBe("location");
    expect(resumeStepKey(form)).toBe("location");
  });

  it("必須がすべて済んでいれば定員と申し込み期限を開く", () => {
    const form = filledForm();
    expect(firstIncompleteMandatoryStep(form)).toBeNull();
    expect(resumeStepKey(form)).toBe("capacity");
  });
});

describe("畳んだステップの要約", () => {
  it("催しの名前・最初の日時・残りの件数を並べる", () => {
    const form = filledForm({
      schedules: [
        filledForm().schedules[0],
        { ...createScheduleDraft(), eventDate: "2026-12-06", startTime: "18:00", endTime: "20:00" },
        { ...createScheduleDraft(), eventDate: "2026-12-07", startTime: "18:00", endTime: "20:00" },
      ],
    });
    expect(summarizeStep("basic", form)).toBe("忘年会 / 12月5日（土） 18:00〜20:00 / ほか2件");
  });

  it("費用プランは2件まで金額を出し、残りは件数にする", () => {
    const form = filledForm({
      pricePlans: [
        createPricePlanDraft({ name: "一般", amount: "3000" }),
        createPricePlanDraft({ name: "学生", amount: "2000" }),
        createPricePlanDraft({ name: "招待", amount: "0" }),
      ],
    });
    expect(summarizeStep("pricing", form)).toBe("一般 3,000円 / 学生 2,000円 ほか1件");
  });

  it("定員と期限が空なら「定員なし / 期限なし」", () => {
    expect(summarizeStep("capacity", filledForm())).toBe("定員なし / 期限なし");
  });

  it("定員と期限を入れるとその値を出す", () => {
    const form = filledForm({ capacity: 30, rsvpDeadline: "2026-12-01T23:59" });
    expect(summarizeStep("capacity", form)).toBe("定員 30名 / 期限 12月1日 23:59");
  });

  it("場所は公開ページと同じ表記にする", () => {
    const form = filledForm({ venueName: "渋谷ホール", prefecture: "東京都", city: "渋谷区", addressLine: "1-2-3" });
    expect(summarizeStep("location", form)).toBe("渋谷ホール 東京都渋谷区1-2-3");
  });

  it("何も入っていない項目は要約を出さない", () => {
    expect(summarizeStep("basic", EMPTY_EVENT_FORM)).toBeNull();
    expect(summarizeStep("pricing", EMPTY_EVENT_FORM)).toBeNull();
    expect(summarizeStep("location", EMPTY_EVENT_FORM)).toBeNull();
  });
});

describe("短い日付表記", () => {
  it("日付を月日と曜日にする", () => {
    expect(formatShortDate("2026-12-05")).toBe("12月5日（土）");
    expect(formatShortDate("2026-01-01")).toBe("1月1日（木）");
  });

  it("読めない日付はそのまま返す", () => {
    expect(formatShortDate("")).toBe("");
    expect(formatShortDate("2026-13-99")).toBe("2026-13-99");
  });

  it("申し込み期限を月日と時刻にする", () => {
    expect(formatShortDeadline("2026-12-01T23:59")).toBe("12月1日 23:59");
    expect(formatShortDeadline("")).toBe("");
  });
});
