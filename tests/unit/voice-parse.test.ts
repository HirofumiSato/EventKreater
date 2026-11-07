import { describe, expect, it } from "vitest";
import { EMPTY_EVENT_FORM, createPricePlanDraft, createScheduleDraft, type EventFormValues } from "@/modules/events/types";
import {
  cleanTranscript,
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
  parseVoicePlanName,
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

describe("認識結果の整え", () => {
  it("末尾の 。！？ と空白だけを落とし、文の途中の記号は残す", () => {
    expect(cleanTranscript("18時。")).toBe("18時");
    expect(cleanTranscript("18時！？")).toBe("18時");
    expect(cleanTranscript("  18時  ")).toBe("18時");
    // 途中の記号は、話した言葉の区切りとして残す。
    expect(cleanTranscript("18時、20時")).toBe("18時、20時");
    expect(cleanTranscript("18時。次は会場名")).toBe("18時。次は会場名");
  });

  it("句読点だけなら空にする", () => {
    expect(cleanTranscript("  。 ")).toBe("");
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

describe("行の指定", () => {
  it("row を渡すと 2 行目だけが変わる", () => {
    const value = withRows({
      schedules: [
        createScheduleDraft({ eventDate: "2026-12-05" }),
        createScheduleDraft({ eventDate: "2026-12-06" }),
      ],
    });
    const patch = parseVoiceScheduleDate("12月10日", { now: NOW, value, row: 1 });
    expect(patch?.schedules?.[0].eventDate).toBe("2026-12-05");
    expect(patch?.schedules?.[1].eventDate).toBe("2026-12-10");
  });

  it("料金プランの金額も行ごとに入れ替える", () => {
    const value = withRows({
      pricePlans: [
        createPricePlanDraft({ key: "m-1", name: "一般", amount: "3000", audience: "MALE" }),
        createPricePlanDraft({ key: "f-1", name: "一般", amount: "2000", audience: "FEMALE" }),
      ],
    });
    const patch = parseVoicePlanAmount("2500円", { now: NOW, value, row: 1 });
    expect(patch?.pricePlans?.[0].amount).toBe("3000");
    expect(patch?.pricePlans?.[1].amount).toBe("2500");
  });

  it("行が無ければ別の行を埋めずに null を返す", () => {
    expect(parseVoiceScheduleDate("12月10日", { now: NOW, value: withRows(), row: 3 })).toBeNull();
    expect(parseVoicePlanAmount("3000円", { now: NOW, value: withRows(), row: 3 })).toBeNull();
  });
});

describe("男女別のプラン名", () => {
  it("組名をその組の両方の行へ入れる", () => {
    const value = withRows({
      pricePlans: [
        createPricePlanDraft({ key: "m-1", name: "", audience: "MALE" }),
        createPricePlanDraft({ key: "f-1", name: "", audience: "FEMALE" }),
      ],
    });
    const patch = parseVoicePlanName("一般", { now: NOW, value, row: 0 });
    expect(patch?.pricePlans?.map((plan) => plan.name)).toEqual(["一般", "一般"]);
  });

  it("2 組目を指定すると 2 組目だけが変わる", () => {
    const value = withRows({
      pricePlans: [
        createPricePlanDraft({ key: "m-1", name: "一般", audience: "MALE" }),
        createPricePlanDraft({ key: "f-1", name: "一般", audience: "FEMALE" }),
        createPricePlanDraft({ key: "m-2", name: "", audience: "MALE" }),
        createPricePlanDraft({ key: "f-2", name: "", audience: "FEMALE" }),
      ],
    });
    const patch = parseVoicePlanName("学生", { now: NOW, value, row: 1 });
    expect(patch?.pricePlans?.map((plan) => plan.name)).toEqual(["一般", "一般", "学生", "学生"]);
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

  it("「前日」は開催日から 1 日前の 23:59 にする", () => {
    const patch = parseVoiceRsvpDeadline("前日", context(withRows()));
    expect(patch?.rsvpDeadline).toBe("2026-12-04T23:59");
  });

  it("「当日」は開催日の 23:59 にする", () => {
    const patch = parseVoiceRsvpDeadline("当日", context(withRows()));
    expect(patch?.rsvpDeadline).toBe("2026-12-05T23:59");
  });

  it("「3日前」「1週間前」を開催日から逆算する", () => {
    expect(parseVoiceRsvpDeadline("3日前", context(withRows()))?.rsvpDeadline).toBe(
      "2026-12-02T23:59",
    );
    expect(parseVoiceRsvpDeadline("1週間前", context(withRows()))?.rsvpDeadline).toBe(
      "2026-11-28T23:59",
    );
  });

  it("時刻を一緒に言えばその時刻にする", () => {
    const patch = parseVoiceRsvpDeadline("前日20時", context(withRows()));
    expect(patch?.rsvpDeadline).toBe("2026-12-04T20:00");
  });

  it("開催日が無ければ今日を基準にする", () => {
    // EMPTY_EVENT_FORM の日程は開催日が空欄。
    expect(parseVoiceRsvpDeadline("前日", context())?.rsvpDeadline).toBe("2026-10-23T23:59");
  });
});

describe("月を言わない日付", () => {
  it("月を言わない「5日」は、今日以降で最も近い月にする", () => {
    // 今日は 10 月 24 日。10 月 5 日は過ぎているので 11 月 5 日。
    expect(parseSpokenDate("5日", NOW)).toEqual({ year: 2026, month: 11, day: 5 });
  });

  it("今日と同じ日なら今日にする", () => {
    expect(parseSpokenDate("24日", NOW)).toEqual({ year: 2026, month: 10, day: 24 });
  });

  it("今月にその日があれば今月にする", () => {
    expect(parseSpokenDate("31日", NOW)).toEqual({ year: 2026, month: 10, day: 31 });
  });

  it("翌月に無い日は、その日がある月まで送る", () => {
    // 11 月 31 日は無いので 12 月 31 日。
    const november = new Date("2026-11-01T09:00:00+09:00");
    expect(parseSpokenDate("31日", november)).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it("年をまたぐ月は翌年にする", () => {
    const december = new Date("2026-12-20T09:00:00+09:00");
    expect(parseSpokenDate("5日", december)).toEqual({ year: 2027, month: 1, day: 5 });
  });

  it("日を数字で言えば、曜日より日を優先する", () => {
    // 日を数字で言うほうが具体的なので、「5日の土曜」は 5 日を採る。
    expect(parseSpokenDate("5日の土曜", NOW)).toEqual({ year: 2026, month: 11, day: 5 });
  });

  it("「3日前」のような相対表現は日付として読まない", () => {
    expect(parseSpokenDate("3日前", NOW)).toBeNull();
  });

  it("「来月」「再来月」は月初にする", () => {
    expect(parseSpokenDate("来月", NOW)).toEqual({ year: 2026, month: 11, day: 1 });
    expect(parseSpokenDate("再来月", NOW)).toEqual({ year: 2026, month: 12, day: 1 });
  });

  it("「来月5日」は翌月のその日にする", () => {
    expect(parseSpokenDate("来月5日", NOW)).toEqual({ year: 2026, month: 11, day: 5 });
  });

  it("「今月末」「来月末」はその月の末日にする", () => {
    expect(parseSpokenDate("今月末", NOW)).toEqual({ year: 2026, month: 10, day: 31 });
    expect(parseSpokenDate("来月末", NOW)).toEqual({ year: 2026, month: 11, day: 30 });
  });
});

describe("曜日の日付", () => {
  // 2026 年 10 月 24 日は土曜日。
  it("「次の土曜」は今日より後で最も近い土曜にする", () => {
    expect(parseSpokenDate("次の土曜", NOW)).toEqual({ year: 2026, month: 10, day: 31 });
  });

  it("「土曜」だけなら今日以降で最も近い土曜にする", () => {
    expect(parseSpokenDate("土曜日", NOW)).toEqual({ year: 2026, month: 10, day: 24 });
  });

  it("「来週の金曜」は来週の金曜にする", () => {
    // 今週は 10 月 18 日（日）始まり。来週の金曜は 10 月 30 日。
    expect(parseSpokenDate("来週の金曜", NOW)).toEqual({ year: 2026, month: 10, day: 30 });
  });

  it("「今週」の日が過ぎていれば翌週へ送る", () => {
    // 今週の月曜は 10 月 19 日で過ぎているため、10 月 26 日。
    expect(parseSpokenDate("今週の月曜", NOW)).toEqual({ year: 2026, month: 10, day: 26 });
  });

  it("「再来週」は 2 週間後のその曜日にする", () => {
    expect(parseSpokenDate("再来週の月曜", NOW)).toEqual({ year: 2026, month: 11, day: 2 });
  });
});

describe("朝・昼・夜の時刻", () => {
  it("「朝から」を 9:00 にする", () => {
    expect(parseSpokenClock("朝から")).toEqual({ hour: 9, minute: 0 });
  });

  it("「昼から」を 12:00 にする", () => {
    expect(parseSpokenClock("昼から")).toEqual({ hour: 12, minute: 0 });
  });

  it("「夜7時」を 19:00 にする", () => {
    expect(parseSpokenClock("夜7時")).toEqual({ hour: 19, minute: 0 });
    expect(parseSpokenClock("夜7時半")).toEqual({ hour: 19, minute: 30 });
  });

  it("「朝9時」のように時刻を言えば、その時刻をそのまま使う", () => {
    expect(parseSpokenClock("朝9時")).toEqual({ hour: 9, minute: 0 });
  });
});

describe("長さから終了時刻を決める", () => {
  it("「18時から2時間」で開始と終了を同時に入れる", () => {
    const patch = parseVoiceScheduleStart("18時から2時間", context());
    expect(patch?.schedules?.[0].startTime).toBe("18:00");
    expect(patch?.schedules?.[0].endTime).toBe("20:00");
  });

  it("「2時間半」を同じ行の開始時刻から計算する", () => {
    const patch = parseVoiceScheduleEnd("2時間半", context(withRows()));
    expect(patch?.schedules?.[0].endTime).toBe("20:30");
  });

  it("終了の欄で「18時から2時間」と言えば、言った開始を基準にする", () => {
    const patch = parseVoiceScheduleEnd("18時から2時間", context(withRows()));
    expect(patch?.schedules?.[0].endTime).toBe("20:00");
  });

  it("開始時刻が無ければ、長さだけでは終了を決めない", () => {
    expect(parseVoiceScheduleEnd("2時間", context())).toBeNull();
  });

  it("0 時をまたぐ長さは受け付けない（翌日へは回さない）", () => {
    expect(parseVoiceScheduleStart("23時から2時間", context())).toBeNull();
    const value = withRows({
      schedules: [createScheduleDraft({ eventDate: "2026-12-05", startTime: "23:00" })],
    });
    expect(parseVoiceScheduleEnd("2時間", { now: NOW, value })).toBeNull();
  });
});

describe("都道府県の略称", () => {
  it.each([
    ["東京", "東京都"],
    ["大阪", "大阪府"],
    ["京都", "京都府"],
    ["沖縄", "沖縄県"],
    ["神奈川", "神奈川県"],
    ["北海道", "北海道"],
  ])("「%s」を %s にする", (input, expected) => {
    expect(parseVoicePrefecture(input)).toEqual({ prefecture: expected });
  });

  it("正式名があればそちらを優先する", () => {
    expect(parseVoicePrefecture("東京都")).toEqual({ prefecture: "東京都" });
    expect(parseVoicePrefecture("京都府です")).toEqual({ prefecture: "京都府" });
  });
});

describe("金額と定員の言い方", () => {
  it("「1人3000円」から 3000 円を読む", () => {
    const patch = parseVoicePlanAmount("1人3000円", context(withRows()));
    expect(patch?.pricePlans?.[0].amount).toBe("3000");
  });

  it("「3000円くらい」から 3000 円を読む", () => {
    const patch = parseVoicePlanAmount("3000円くらい", context(withRows()));
    expect(patch?.pricePlans?.[0].amount).toBe("3000");
  });

  it("「3000円」を無料にしない", () => {
    const patch = parseVoicePlanAmount("3000円", context(withRows()));
    expect(patch?.pricePlans?.[0].amount).toBe("3000");
  });

  it("「30人くらい」を 30 人にする", () => {
    expect(parseVoiceCapacity("30人くらい")).toEqual({ capacity: 30 });
  });
});

describe("既存の抽出を変えない", () => {
  it("「夜の部」のような催しの名前を時刻に変えない", () => {
    expect(parseVoiceTitle("夜の部")).toEqual({ title: "夜の部" });
  });
});
