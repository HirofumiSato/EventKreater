import { describe, expect, it } from "vitest";
import {
  applyVoicePatch,
  describeFieldValue,
  fieldForDomId,
  firstNeededField,
  isFieldNeeded,
  nextNeededField,
  previousField,
  voiceFieldByKey,
  voiceFieldOrder,
  VOICE_FIELDS,
} from "@/modules/events/lib/voice/fields";
import type { VoiceFieldScope } from "@/modules/events/lib/voice/types";
import {
  EMPTY_EVENT_FORM,
  createPricePlanDraft,
  createScheduleDraft,
  type EventFormValues,
} from "@/modules/events/types";

function scope(overrides: Partial<VoiceFieldScope> = {}): VoiceFieldScope {
  return {
    showOrganizerName: false,
    includeOptional: false,
    touched: new Set(),
    ...overrides,
  };
}

/** すべての空欄が埋まった状態。 */
function filledForm(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "忘年会",
    organizerDisplayName: "山田 太郎",
    schedules: [
      createScheduleDraft({ eventDate: "2026-12-05", startTime: "18:00", endTime: "20:00" }),
    ],
    pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000", note: "1ドリンク付" })],
    venueName: "渋谷ホール",
    postalCode: "1500001",
    prefecture: "東京都",
    city: "渋谷区",
    town: "神宮前",
    addressLine: "1-2-3",
    building: "○○ビル3階",
    ...overrides,
  };
}

describe("音声で埋める欄の並び", () => {
  it("画面の上から順に並んでいる", () => {
    const keys = VOICE_FIELDS.map((field) => field.key);
    expect(keys.slice(0, 3)).toEqual(["title", "organizerName", "scheduleDate"]);
    expect(keys.indexOf("postalCode")).toBeLessThan(keys.indexOf("prefecture"));
    expect(keys.at(-1)).toBe("rsvpDeadline");
  });

  it("欄の数だけキーが重複しない", () => {
    const keys = VOICE_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("次に埋める欄の決め方", () => {
  it("空のフォームでは催しの名前から始まる", () => {
    expect(firstNeededField(EMPTY_EVENT_FORM, scope())?.key).toBe("title");
  });

  it("未登録の幹事では主催者名を聞かない", () => {
    const value = { ...EMPTY_EVENT_FORM, title: "忘年会" };
    expect(firstNeededField(value, scope({ showOrganizerName: false }))?.key).toBe("scheduleDate");
  });

  it("未登録の幹事では主催者名を聞く", () => {
    const value = { ...EMPTY_EVENT_FORM, title: "忘年会" };
    expect(firstNeededField(value, scope({ showOrganizerName: true }))?.key).toBe("organizerName");
  });

  it("埋まっている欄は飛ばす", () => {
    const value = { ...EMPTY_EVENT_FORM, title: "忘年会" };
    expect(nextNeededField(value, "title", scope())?.key).toBe("scheduleDate");
  });

  it("郵便番号で住所が埋まっていれば都道府県を聞かない", () => {
    const value = filledForm();
    expect(firstNeededField(value, scope())).toBeNull();
  });

  it("後ろに空欄が無ければ null を返す", () => {
    expect(nextNeededField(filledForm(), "building", scope())).toBeNull();
  });
});

describe("任意の欄", () => {
  it("既定では雨天時の方針・定員・期限を聞かない", () => {
    const keys = voiceFieldOrder(filledForm(), scope()).map((field) => field.key);
    expect(keys).not.toContain("rainPolicy");
    expect(keys).not.toContain("capacity");
    expect(keys).not.toContain("rsvpDeadline");
  });

  it("任意の欄も聞くと、埋まっていても候補に残る", () => {
    const keys = voiceFieldOrder(filledForm(), scope({ includeOptional: true })).map(
      (field) => field.key,
    );
    expect(keys).toContain("rainPolicy");
    expect(keys).toContain("capacity");
    expect(keys).toContain("rsvpDeadline");
  });

  it("一度入れた任意の欄は聞き直さない", () => {
    const touched = new Set(["rainPolicy"] as const);
    const keys = voiceFieldOrder(filledForm(), scope({ includeOptional: true, touched })).map(
      (field) => field.key,
    );
    expect(keys).toContain("capacity");
    const field = voiceFieldByKey("rainPolicy");
    expect(field && isFieldNeeded(field, filledForm(), scope({ includeOptional: true, touched }))).toBe(
      false,
    );
  });
});

describe("戻る", () => {
  it("ひとつ前の欄へ戻る", () => {
    expect(previousField(EMPTY_EVENT_FORM, "scheduleStart", scope())?.key).toBe("scheduleDate");
  });

  it("先頭より前には戻らない", () => {
    expect(previousField(EMPTY_EVENT_FORM, "title", scope())).toBeNull();
  });
});

describe("入力欄からの逆引き", () => {
  it("催しの名前の id から欄を引ける", () => {
    expect(fieldForDomId("event-title", EMPTY_EVENT_FORM, scope())?.key).toBe("title");
  });

  it("先頭の行の開催日を引ける", () => {
    const value = withKey();
    expect(fieldForDomId(`schedule-date-${value.schedules[0].key}`, value, scope())?.key).toBe(
      "scheduleDate",
    );
  });

  it("関係のない id では null を返す", () => {
    expect(fieldForDomId("something-else", EMPTY_EVENT_FORM, scope())).toBeNull();
  });

  it("既定で巡回しない任意の欄も、手で押せば対象になる", () => {
    expect(fieldForDomId("event-rain-policy", EMPTY_EVENT_FORM, scope())?.key).toBe("rainPolicy");
  });
});

function withKey(): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    schedules: [createScheduleDraft({ key: "row-1" })],
  };
}

describe("パッチの適用", () => {
  it("配列は差し替え、ほかの値は残す", () => {
    const next = applyVoicePatch(
      { ...EMPTY_EVENT_FORM, title: "忘年会" },
      { schedules: [createScheduleDraft({ eventDate: "2026-12-05" })] },
    );
    expect(next.title).toBe("忘年会");
    expect(next.schedules[0].eventDate).toBe("2026-12-05");
  });
});

describe("いまの値の言い換え", () => {
  it("定員が無いときは「無制限」と出す", () => {
    const field = voiceFieldByKey("capacity");
    expect(field && describeFieldValue(field, EMPTY_EVENT_FORM)).toBe("無制限");
  });

  it("金額には円を付ける", () => {
    const field = voiceFieldByKey("planAmount");
    const value = { ...EMPTY_EVENT_FORM, pricePlans: [createPricePlanDraft({ amount: "3000" })] };
    expect(field && describeFieldValue(field, value)).toBe("3000円");
  });
});
