import { describe, expect, it } from "vitest";
import {
  applyVoicePatch,
  applyVoicePatches,
  describeFieldValue,
  fieldForDomId,
  firstNeededField,
  isFieldNeeded,
  nextNeededField,
  previousField,
  shouldAskGenderBeforePricing,
  startFieldFor,
  voiceFieldByKey,
  voiceFieldOrder,
  voiceSlotById,
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

/** 開催日時 2 行・料金 2 組。行の id を固定して domId を確かめられるようにする。 */
function multiRowForm(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "忘年会",
    schedules: [
      createScheduleDraft({
        key: "row-1",
        eventDate: "2026-12-05",
        startTime: "18:00",
        endTime: "20:00",
      }),
      createScheduleDraft({
        key: "row-2",
        eventDate: "2026-12-06",
        startTime: "18:00",
        endTime: "20:00",
      }),
    ],
    pricePlans: [
      createPricePlanDraft({ key: "plan-1", name: "一般", amount: "3000", note: "1ドリンク付" }),
      createPricePlanDraft({ key: "plan-2", name: "学生", amount: "2000", note: "" }),
    ],
    ...overrides,
  };
}

/** 男女別の 2 組（男性用・女性用の順）。 */
function genderForm(): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "忘年会",
    schedules: [createScheduleDraft({ key: "row-1" })],
    pricePlans: [
      createPricePlanDraft({ key: "m-1", name: "一般", audience: "MALE", amount: "5000" }),
      createPricePlanDraft({ key: "f-1", name: "一般", audience: "FEMALE", amount: "4000" }),
      createPricePlanDraft({ key: "m-2", name: "学生", audience: "MALE", amount: "3000" }),
      createPricePlanDraft({ key: "f-2", name: "学生", audience: "FEMALE", amount: "2500" }),
    ],
  };
}

describe("音声で埋める欄の定義", () => {
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

describe("音声で埋めるマスの並び", () => {
  it("開催日時は行ごとに、料金は組ごとに並ぶ", () => {
    const ids = voiceFieldOrder(multiRowForm(), scope()).map((slot) => slot.id);
    expect(ids.slice(0, 7)).toEqual([
      "title:0",
      "scheduleDate:0",
      "scheduleStart:0",
      "scheduleEnd:0",
      "scheduleDate:1",
      "scheduleStart:1",
      "scheduleEnd:1",
    ]);
    expect(ids.slice(7, 13)).toEqual([
      "planName:0",
      "planAmount:0",
      "planNote:0",
      "planName:1",
      "planAmount:1",
      "planNote:1",
    ]);
    expect(ids).toContain("venueName:0");
  });

  it("男女別は組ごとにプラン名を 1 つ、金額と補足を行ごとに持つ", () => {
    const ids = voiceFieldOrder(genderForm(), scope()).map((slot) => slot.id);
    expect(ids.filter((id) => id.startsWith("planName"))).toEqual(["planName:0", "planName:1"]);
    expect(ids.filter((id) => id.startsWith("planAmount"))).toEqual([
      "planAmount:0",
      "planAmount:1",
      "planAmount:2",
      "planAmount:3",
    ]);
  });
});

describe("次に埋める欄の決め方", () => {
  it("空のフォームでは催しの名前から始まる", () => {
    expect(firstNeededField(EMPTY_EVENT_FORM, scope())?.id).toBe("title:0");
  });

  it("未登録の幹事では主催者名を聞かない", () => {
    const value = { ...EMPTY_EVENT_FORM, title: "忘年会" };
    expect(firstNeededField(value, scope({ showOrganizerName: false }))?.id).toBe("scheduleDate:0");
  });

  it("未登録の幹事では主催者名を聞く", () => {
    const value = { ...EMPTY_EVENT_FORM, title: "忘年会" };
    expect(firstNeededField(value, scope({ showOrganizerName: true }))?.id).toBe(
      "organizerName:0",
    );
  });

  it("埋まっている欄は飛ばして 2 行目の日付へ進む", () => {
    const value = multiRowForm({
      schedules: [
        createScheduleDraft({
          key: "row-1",
          eventDate: "2026-12-05",
          startTime: "18:00",
          endTime: "20:00",
        }),
        createScheduleDraft({ key: "row-2" }),
      ],
    });
    expect(nextNeededField(value, "scheduleEnd:0", scope())?.id).toBe("scheduleDate:1");
  });

  it("最後の金額のあとは、補足を飛ばして会場名・郵便番号へ進む", () => {
    const value = {
      ...EMPTY_EVENT_FORM,
      title: "忘年会",
      schedules: [
        createScheduleDraft({ eventDate: "2026-12-05", startTime: "18:00", endTime: "20:00" }),
      ],
      pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000", note: "" })],
    };
    // 補足を聞かない設定でも、補足をスキップしたあと（既定の「任意の項目も聞く」）でも、
    // 最後の金額の次は会場名、その次は郵便番号へ進む。
    expect(nextNeededField(value, "planAmount:0", scope())?.id).toBe("venueName:0");
    const skippedNote = scope({ includeOptional: true, touched: new Set(["planNote"] as const) });
    expect(nextNeededField(value, "planAmount:0", skippedNote)?.id).toBe("venueName:0");
    expect(nextNeededField(value, "venueName:0", skippedNote)?.id).toBe("postalCode:0");
  });

  it("郵便番号で住所が埋まっていれば都道府県を聞かない", () => {
    expect(firstNeededField(filledForm(), scope())).toBeNull();
  });

  it("後ろに空欄が無ければ null を返す", () => {
    expect(nextNeededField(filledForm(), "building:0", scope())).toBeNull();
  });
});

describe("料金の入口で男女別を聞くか", () => {
  it("共通の料金だけなら、プラン名の直前に聞く", () => {
    expect(shouldAskGenderBeforePricing(EMPTY_EVENT_FORM)).toBe(true);
  });

  it("男女別の行が 1 つでもあれば聞かない", () => {
    expect(shouldAskGenderBeforePricing(genderForm())).toBe(false);
  });

  it("料金の行が無ければ聞かない", () => {
    expect(shouldAskGenderBeforePricing({ ...EMPTY_EVENT_FORM, pricePlans: [] })).toBe(false);
  });
});

describe("任意の欄", () => {
  it("料金の補足は任意で、既定では空でも埋める対象にしない", () => {
    const field = voiceFieldByKey("planNote");
    const value = {
      ...EMPTY_EVENT_FORM,
      pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000", note: "" })],
    };
    expect(field?.optional).toBe(true);
    expect(field && isFieldNeeded(field, value, scope())).toBe(false);
    expect(field && isFieldNeeded(field, value, scope({ includeOptional: true }))).toBe(true);
  });

  it("既定では雨天時の方針・定員・期限を聞かない", () => {
    const keys = voiceFieldOrder(filledForm(), scope()).map((slot) => slot.key);
    expect(keys).not.toContain("rainPolicy");
    expect(keys).not.toContain("capacity");
    expect(keys).not.toContain("rsvpDeadline");
  });

  it("任意の欄も聞くと、埋まっていても候補に残る", () => {
    const keys = voiceFieldOrder(filledForm(), scope({ includeOptional: true })).map(
      (slot) => slot.key,
    );
    expect(keys).toContain("rainPolicy");
    expect(keys).toContain("capacity");
    expect(keys).toContain("rsvpDeadline");
  });

  it("一度入れた任意の欄は聞き直さない", () => {
    const touched = new Set(["rainPolicy"] as const);
    const keys = voiceFieldOrder(filledForm(), scope({ includeOptional: true, touched })).map(
      (slot) => slot.key,
    );
    expect(keys).toContain("capacity");
    const field = voiceFieldByKey("rainPolicy");
    expect(field && isFieldNeeded(field, filledForm(), scope({ includeOptional: true, touched }))).toBe(
      false,
    );
  });
});

describe("音声を始める欄", () => {
  it("直前に選んでいた欄から始まる", () => {
    const value = { ...EMPTY_EVENT_FORM, title: "忘年会" };
    expect(startFieldFor(value, scope(), "event-venue-name")?.key).toBe("venueName");
  });

  it("選んでいた欄が無ければ最初の空欄から始まる", () => {
    const value = { ...EMPTY_EVENT_FORM, title: "忘年会" };
    expect(startFieldFor(value, scope(), null)?.id).toBe("scheduleDate:0");
  });

  it("選んでいた欄が画面に無ければ最初の空欄から始まる", () => {
    expect(startFieldFor(EMPTY_EVENT_FORM, scope(), "something-else")?.id).toBe("title:0");
  });

  it("既定で巡回しない任意の欄も、選んでいればそこから始まる", () => {
    expect(startFieldFor(EMPTY_EVENT_FORM, scope(), "event-capacity")?.id).toBe("capacity:0");
  });

  it("2 行目の入力欄から始めると、その行のマスになる", () => {
    expect(startFieldFor(multiRowForm(), scope(), "schedule-date-row-2")?.id).toBe(
      "scheduleDate:1",
    );
  });
});

describe("戻る", () => {
  it("ひとつ前の欄へ戻る", () => {
    expect(previousField(EMPTY_EVENT_FORM, "scheduleStart:0", scope())?.id).toBe(
      "scheduleDate:0",
    );
  });

  it("行をまたぐときも、日時が終わってから次の行の日付へ進む", () => {
    expect(previousField(multiRowForm(), "scheduleDate:1", scope())?.id).toBe("scheduleEnd:0");
    expect(previousField(multiRowForm(), "planName:1", scope())?.id).toBe("planNote:0");
  });

  it("先頭より前には戻らない", () => {
    expect(previousField(EMPTY_EVENT_FORM, "title:0", scope())).toBeNull();
  });
});

describe("入力欄からの逆引き", () => {
  it("催しの名前の id から欄を引ける", () => {
    expect(fieldForDomId("event-title", EMPTY_EVENT_FORM, scope())?.id).toBe("title:0");
  });

  it("先頭の行の開催日を引ける", () => {
    const value = multiRowForm();
    expect(fieldForDomId("schedule-date-row-1", value, scope())?.id).toBe("scheduleDate:0");
  });

  it("2 行目の開催日時を引ける", () => {
    const value = multiRowForm();
    expect(fieldForDomId("schedule-date-row-2", value, scope())?.id).toBe("scheduleDate:1");
    expect(fieldForDomId("schedule-start-row-2", value, scope())?.id).toBe("scheduleStart:1");
    expect(fieldForDomId("schedule-end-row-2", value, scope())?.id).toBe("scheduleEnd:1");
  });

  it("2 組目のプラン名は組の先頭の行の id で引ける", () => {
    const value = genderForm();
    expect(fieldForDomId("plan-name-m-2", value, scope())?.id).toBe("planName:1");
  });

  it("女性の金額のスロットを引ける", () => {
    const value = genderForm();
    const slot = fieldForDomId("plan-amount-f-1", value, scope());
    expect(slot?.id).toBe("planAmount:1");
    expect(slot?.label).toBe("女性の金額");
    expect(slot?.prompt).toBe("女性の金額は？");
  });

  it("男性の金額は行の番号ではなく性別で呼ぶ", () => {
    expect(fieldForDomId("plan-amount-m-2", genderForm(), scope())?.label).toBe("男性の金額");
  });

  it("関係のない id では null を返す", () => {
    expect(fieldForDomId("something-else", EMPTY_EVENT_FORM, scope())).toBeNull();
  });

  it("既定で巡回しない任意の欄も、手で押せば対象になる", () => {
    expect(fieldForDomId("event-rain-policy", EMPTY_EVENT_FORM, scope())?.id).toBe("rainPolicy:0");
  });
});

describe("カーソルの id からの引き直し", () => {
  it("2 行目の開催日は「2件目の開催日」になる", () => {
    const slot = voiceSlotById("scheduleDate:1", multiRowForm(), scope());
    expect(slot?.label).toBe("2件目の開催日");
    expect(slot?.prompt).toBe("2件目の開催日は？");
  });

  it("巡回から外れた任意の欄でも定義から引き直せる", () => {
    expect(voiceSlotById("capacity:0", EMPTY_EVENT_FORM, scope())?.key).toBe("capacity");
  });
});

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

describe("複数のパッチの適用", () => {
  const now = new Date("2026-11-06T09:00:00+09:00");

  it("開催日と開始時刻を順に当てても、両方の値が残る", () => {
    const base = { ...EMPTY_EVENT_FORM, schedules: [createScheduleDraft({ key: "row-1" })] };
    const date = voiceFieldByKey("scheduleDate");
    const start = voiceFieldByKey("scheduleStart");
    if (!date || !start) throw new Error("欄の定義がありません");

    const context = { now, value: base, row: 0 };
    const datePatch = date.parse("12月5日", context);
    const startPatch = start.parse("18時", context);
    if (!datePatch || !startPatch) throw new Error("パッチを作れませんでした");

    // どちらのパッチも `base` の行を丸ごと持つ。行単位で合成しないと、
    // 開始時刻のパッチが開催日を巻き戻す。
    const next = applyVoicePatches(base, [datePatch, startPatch]);
    expect(next.schedules).toHaveLength(1);
    expect(next.schedules[0].key).toBe("row-1");
    expect(next.schedules[0].eventDate).toBe("2026-12-05");
    expect(next.schedules[0].startTime).toBe("18:00");
  });

  it("パッチに無い行と、行の中のほかの値は残す", () => {
    const base = {
      ...EMPTY_EVENT_FORM,
      schedules: [
        createScheduleDraft({
          key: "row-1",
          eventDate: "2026-12-05",
          startTime: "18:00",
          endTime: "20:00",
        }),
        createScheduleDraft({ key: "row-2", eventDate: "2026-12-06" }),
      ],
    };
    const end = voiceFieldByKey("scheduleEnd");
    if (!end) throw new Error("欄の定義がありません");
    const patch = end.parse("21時", { now, value: base, row: 0 });
    if (!patch) throw new Error("パッチを作れませんでした");

    const next = applyVoicePatches(base, [patch]);
    expect(next.schedules).toHaveLength(2);
    expect(next.schedules[0].eventDate).toBe("2026-12-05");
    expect(next.schedules[0].startTime).toBe("18:00");
    expect(next.schedules[0].endTime).toBe("21:00");
    expect(next.schedules[1].eventDate).toBe("2026-12-06");
  });

  it("料金の行も key で突き合わせて合成する", () => {
    const base = {
      ...EMPTY_EVENT_FORM,
      pricePlans: [
        createPricePlanDraft({ key: "plan-1", name: "一般" }),
        createPricePlanDraft({ key: "plan-2", name: "学生" }),
      ],
    };
    const name = voiceFieldByKey("planName");
    const amount = voiceFieldByKey("planAmount");
    if (!name || !amount) throw new Error("欄の定義がありません");

    const context = { now, value: base, row: 0 };
    const namePatch = name.parse("一般", context);
    const amountPatch = amount.parse("3000円", context);
    if (!namePatch || !amountPatch) throw new Error("パッチを作れませんでした");

    const next = applyVoicePatches(base, [namePatch, amountPatch]);
    expect(next.pricePlans).toHaveLength(2);
    expect(next.pricePlans[0].name).toBe("一般");
    expect(next.pricePlans[0].amount).toBe("3000");
    expect(next.pricePlans[1].name).toBe("学生");
  });

  it("行の配列以外のキーは、後のパッチを優先する", () => {
    const next = applyVoicePatches({ ...EMPTY_EVENT_FORM, title: "" }, [
      { title: "忘年会" },
      { title: "新年会", venueName: "渋谷ホール" },
    ]);
    expect(next.title).toBe("新年会");
    expect(next.venueName).toBe("渋谷ホール");
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

  it("行を渡すとその行の値を返す", () => {
    const value = genderForm();
    const amount = voiceFieldByKey("planAmount");
    const name = voiceFieldByKey("planName");
    const date = voiceFieldByKey("scheduleDate");
    expect(amount && describeFieldValue(amount, value, 1)).toBe("4000円");
    expect(name && describeFieldValue(name, value, 1)).toBe("学生");
    expect(date && describeFieldValue(date, multiRowForm(), 1)).toBe("2026-12-06");
  });
});
