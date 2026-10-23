import { describe, expect, it } from "vitest";
import { EMPTY_EVENT_FORM, createPricePlanDraft, createScheduleDraft, type EventFormValues } from "@/modules/events/types";
import {
  normalizeSpokenText,
  normalizeTimeWords,
  parseJapaneseNumber,
  parseSpokenClock,
  parseSpokenDate,
  splitTimeRange,
  toHalfWidth,
} from "@/modules/events/lib/voice/normalize";
import {
  parseVoiceAddressLine,
  parseVoiceCapacity,
  parseVoicePlanAmount,
  parseVoicePrefecture,
  parseVoicePostalCode,
  parseVoiceRainPolicy,
  parseVoiceRsvpDeadline,
  parseVoiceScheduleDate,
  parseVoiceScheduleEnd,
  parseVoiceScheduleStart,
  parseVoiceTitle,
} from "@/modules/events/lib/voice/parse";
import type { VoiceContext } from "@/modules/events/lib/voice/types";

/** 2026 年 10 月 24 日（日本時間）を基準にする。相対日付のテストを固定するため。 */
const NOW = new Date("2026-10-24T09:00:00+09:00");

function context(overrides: Partial<EventFormValues> = {}): VoiceContext {
  return {
    now: NOW,
    value: { ...EMPTY_EVENT_FORM, ...overrides },
  };
}

/** 先頭の行を持つ状態。行の id を固定して domId を確かめられるようにする。 */
function withRows(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    schedules: [createScheduleDraft({ eventDate: "2026-12-05", startTime: "18:00", endTime: "20:00" })],
    pricePlans: [createPricePlanDraft({ name: "一般", amount: "3000" })],
    ...overrides,
  };
}

describe("話し言葉の正規化", () => {
  it("全角の数字とコロンを半角にする", () => {
    expect(toHalfWidth("１９：３０")).toBe("19:30");
  });

  it("「19時半」を19:30にする", () => {
    expect(normalizeTimeWords("19時半")).toBe("19:30");
  });

  it("「19時30分」を19:30にする", () => {
    expect(normalizeTimeWords("19時30分")).toBe("19:30");
  });

  it("漢数字の時刻「十八時」を18:00にする", () => {
    expect(normalizeSpokenText("十八時")).toBe("18:00");
  });

  it("語尾の「です」を落とす", () => {
    expect(normalizeSpokenText("忘年会です")).toBe("忘年会");
  });

  it("「一般」のような漢字の語を数字に変えない", () => {
    expect(parseJapaneseNumber("一般")).toBeNull();
    expect(normalizeSpokenText("一般")).toBe("一般");
  });
});

describe("漢数字とアラビア数字の読み取り", () => {
  it.each([
    ["3000", 3000],
    ["三千", 3000],
    ["3千", 3000],
    ["千五百", 1500],
    ["二十五", 25],
    ["一万", 10000],
    ["10", 10],
  ])("「%s」を %i にする", (input, expected) => {
    expect(parseJapaneseNumber(input)).toBe(expected);
  });

  it("数字として読めない語は null にする", () => {
    expect(parseJapaneseNumber("たくさん")).toBeNull();
  });
});

describe("日付の読み取り", () => {
  it("「12月5日」を今年の12月5日にする", () => {
    expect(parseSpokenDate("12月5日", NOW)).toEqual({ year: 2026, month: 12, day: 5 });
  });

  it("今日より前になる月日は翌年として扱う", () => {
    expect(parseSpokenDate("1月10日", NOW)).toEqual({ year: 2027, month: 1, day: 10 });
  });

  it("年が付いていればその年を使う", () => {
    expect(parseSpokenDate("2027年3月1日", NOW)).toEqual({ year: 2027, month: 3, day: 1 });
  });

  it("「12/5」を月日として読む", () => {
    expect(parseSpokenDate("12/5", NOW)).toEqual({ year: 2026, month: 12, day: 5 });
  });

  it("存在しない日付は null にする", () => {
    expect(parseSpokenDate("2月30日", NOW)).toBeNull();
  });
});

describe("時刻の読み取り", () => {
  it("「18時から20時まで」を開始と終了に分ける", () => {
    expect(splitTimeRange("18時から20時まで")).toEqual({ start: "18:00", end: "20:00" });
  });

  it("「19時半」を 19:30 にする", () => {
    expect(parseSpokenClock("19時半")).toEqual({ hour: 19, minute: 30 });
  });

  it("24 時以上は受け付けない", () => {
    expect(parseSpokenClock("25時")).toBeNull();
  });
});

describe("催しの名前", () => {
  it("「忘年会です」を催しの名前にする", () => {
    expect(parseVoiceTitle("忘年会です")).toEqual({ title: "忘年会" });
  });

  it("空の発話は受け付けない", () => {
    expect(parseVoiceTitle("です")).toBeNull();
  });
});

describe("開催日時", () => {
  it("「12月5日」を開催日に入れる", () => {
    const patch = parseVoiceScheduleDate("12月5日", context());
    expect(patch?.schedules?.[0].eventDate).toBe("2026-12-05");
  });

  it("「18時から20時まで」で開始と終了を同時に入れる", () => {
    const patch = parseVoiceScheduleStart("18時から20時まで", context());
    expect(patch?.schedules?.[0].startTime).toBe("18:00");
    expect(patch?.schedules?.[0].endTime).toBe("20:00");
  });

  it("開始と同じ時刻を終了に指定できない", () => {
    expect(parseVoiceScheduleEnd("18時", context(withRows()))).toBeNull();
  });

  it("終了時刻を単独で入れる", () => {
    const patch = parseVoiceScheduleEnd("21時半", context(withRows()));
    expect(patch?.schedules?.[0].endTime).toBe("21:30");
  });

  it("開催日を言い直しても他の行を壊さない", () => {
    const value = withRows({
      schedules: [
        createScheduleDraft({ eventDate: "2026-12-05" }),
        createScheduleDraft({ eventDate: "2026-12-06" }),
      ],
    });
    const patch = parseVoiceScheduleDate("12月10日", { now: NOW, value });
    expect(patch?.schedules).toHaveLength(2);
    expect(patch?.schedules?.[1].eventDate).toBe("2026-12-06");
  });
});

describe("金額", () => {
  it.each([
    ["3000円", "3000"],
    ["三千円", "3000"],
    ["3千円", "3000"],
    ["千五百円", "1500"],
    ["無料", "0"],
  ])("「%s」を %s にする", (input, expected) => {
    const patch = parseVoicePlanAmount(input, context(withRows()));
    expect(patch?.pricePlans?.[0].amount).toBe(expected);
  });

  it("上限を超える金額は受け付けない", () => {
    expect(parseVoicePlanAmount("1億円", context(withRows()))).toBeNull();
  });
});

describe("定員", () => {
  it("「30人」を30にする", () => {
    expect(parseVoiceCapacity("30人")).toEqual({ capacity: 30 });
  });

  it("「三十人」を30にする", () => {
    expect(parseVoiceCapacity("三十人")).toEqual({ capacity: 30 });
  });

  it("「無制限」は null にする", () => {
    expect(parseVoiceCapacity("無制限")).toEqual({ capacity: null });
  });
});

describe("郵便番号と住所", () => {
  it("「150の0001」を7桁にする", () => {
    expect(parseVoicePostalCode("150の0001")).toEqual({ postalCode: "1500001" });
  });

  it("7桁でなければ受け付けない", () => {
    expect(parseVoicePostalCode("150")).toBeNull();
  });

  it("都道府県を一覧から選ぶ", () => {
    expect(parseVoicePrefecture("東京都です")).toEqual({ prefecture: "東京都" });
    expect(parseVoicePrefecture("どこか")).toBeNull();
  });

  it("「1の2の3」を「1-2-3」にする", () => {
    expect(parseVoiceAddressLine("1の2の3")).toEqual({ addressLine: "1-2-3" });
  });
});

describe("雨天時の方針", () => {
  it.each([
    ["雨天決行", "RAIN_OR_SHINE"],
    ["雨天中止", "CANCEL_ON_RAIN"],
    ["雨なら順延", "POSTPONE_ON_RAIN"],
    ["屋内でやります", "INDOOR"],
  ])("「%s」を %s にする", (input, expected) => {
    expect(parseVoiceRainPolicy(input)).toEqual({ rainPolicy: expected });
  });
});

describe("申し込み期限", () => {
  it("日時をそのまま入れる", () => {
    const patch = parseVoiceRsvpDeadline("12月1日23時59分", context());
    expect(patch?.rsvpDeadline).toBe("2026-12-01T23:59");
  });

  it("時刻を言わなければ 23:59 にする", () => {
    const patch = parseVoiceRsvpDeadline("12月1日", context());
    expect(patch?.rsvpDeadline).toBe("2026-12-01T23:59");
  });

  it("「なし」で期限を消す", () => {
    expect(parseVoiceRsvpDeadline("なし", context())).toEqual({ rsvpDeadline: "" });
  });
});
