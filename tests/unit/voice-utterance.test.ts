import { describe, expect, it } from "vitest";
import { assignUtterance, splitUtterance } from "@/modules/events/lib/voice/utterance";
import type { VoiceFieldScope } from "@/modules/events/lib/voice/types";
import { EMPTY_EVENT_FORM, type EventFormValues } from "@/modules/events/types";

/** 2026 年 10 月 24 日（日本時間）を基準にする。相対日付のテストを固定するため。 */
const NOW = new Date("2026-10-24T09:00:00+09:00");

function scope(overrides: Partial<VoiceFieldScope> = {}): VoiceFieldScope {
  return {
    showOrganizerName: false,
    includeOptional: false,
    touched: new Set(),
    ...overrides,
  };
}

function assign(
  text: string,
  overrides: { value?: EventFormValues; includeOptional?: boolean } = {},
) {
  const result = assignUtterance({
    text,
    value: overrides.value ?? EMPTY_EVENT_FORM,
    now: NOW,
    scope: scope({ includeOptional: overrides.includeOptional ?? false }),
  });
  return {
    ...result,
    slotIds: result.assignments.map((assignment) => assignment.slotId),
    bySlot: new Map(result.assignments.map((assignment) => [assignment.slotId, assignment])),
  };
}

describe("発話の節分割", () => {
  it("読点・句点・カンマ・終止点で分ける", () => {
    expect(splitUtterance("12月5日、18時。渋谷ホール,3000円．30人")).toEqual([
      { text: "12月5日", index: 0 },
      { text: "18時", index: 6 },
      { text: "渋谷ホール", index: 10 },
      { text: "3000円", index: 16 },
      { text: "30人", index: 22 },
    ]);
  });

  it("話し言葉の「で」「と」「や」でも分ける", () => {
    expect(splitUtterance("渋谷ホールで忘年会")).toEqual([
      { text: "渋谷ホール", index: 0 },
      { text: "忘年会", index: 6 },
    ]);
    expect(splitUtterance("3000円と30人")).toEqual([
      { text: "3000円", index: 0 },
      { text: "30人", index: 6 },
    ]);
    expect(splitUtterance("一般や学生")).toEqual([
      { text: "一般", index: 0 },
      { text: "学生", index: 3 },
    ]);
  });

  it("連続する空白で分け、前後の空白は落とす", () => {
    expect(splitUtterance("  渋谷ホール   忘年会  ")).toEqual([
      { text: "渋谷ホール", index: 2 },
      { text: "忘年会", index: 10 },
    ]);
  });

  it("空の節は捨てる", () => {
    expect(splitUtterance("、、  。")).toEqual([]);
    expect(splitUtterance("。12月5日、、")).toEqual([{ text: "12月5日", index: 1 }]);
  });
});

describe("まとめて話した発話の割当", () => {
  it("日付・時刻・会場・金額・定員を 1 回で埋める", () => {
    const result = assign("12月5日、18時から20時、渋谷ホール、3000円、30人", {
      includeOptional: true,
    });

    expect(result.bySlot.get("scheduleDate:0")?.text).toBe("12月5日");
    expect(result.bySlot.get("scheduleDate:0")?.patch.schedules?.[0].eventDate).toBe("2026-12-05");

    expect(result.bySlot.get("scheduleStart:0")?.text).toBe("18時から20時");
    expect(result.bySlot.get("scheduleStart:0")?.patch.schedules?.[0]).toMatchObject({
      startTime: "18:00",
      endTime: "20:00",
    });

    expect(result.bySlot.get("venueName:0")?.text).toBe("渋谷ホール");
    expect(result.bySlot.get("venueName:0")?.patch).toEqual({ venueName: "渋谷ホール" });

    expect(result.bySlot.get("planAmount:0")?.text).toBe("3000円");
    expect(result.bySlot.get("planAmount:0")?.patch.pricePlans?.[0].amount).toBe("3000");

    expect(result.bySlot.get("capacity:0")?.text).toBe("30人");
    expect(result.bySlot.get("capacity:0")?.patch).toEqual({ capacity: 30 });

    expect(result.unassigned).toEqual([]);
  });

  it("開始が範囲を返したら終了は二重に割り当てない", () => {
    const result = assign("18時から20時", { includeOptional: true });

    expect(result.slotIds).toEqual(["scheduleStart:0"]);
    expect(result.bySlot.has("scheduleEnd:0")).toBe(false);
    expect(result.bySlot.get("scheduleStart:0")?.patch.schedules?.[0]).toMatchObject({
      startTime: "18:00",
      endTime: "20:00",
    });
  });

  it("数字の節は自由文の欄より先に、形の閉じた欄へ入る", () => {
    const result = assign("30人、渋谷ホール", { includeOptional: true });

    // 巡回順では会場名が定員より先だが、自由文は最後に回すので 30人 は会場名へ行かない。
    expect(result.bySlot.get("capacity:0")?.text).toBe("30人");
    expect(result.bySlot.get("capacity:0")?.patch).toEqual({ capacity: 30 });
    expect(result.bySlot.get("venueName:0")?.text).toBe("渋谷ホール");
  });

  it("どの欄にも当たらない節を未割当として返す", () => {
    const result = assign("よろしく、渋谷ホール", { includeOptional: true });

    expect(result.bySlot.get("venueName:0")?.text).toBe("渋谷ホール");
    expect(result.unassigned).toEqual(["よろしく"]);
  });

  it("空文字と句読点だけの入力では、割当も未割当も空になる", () => {
    for (const text of ["", "   ", "、。，", "。。、、．"]) {
      const result = assign(text, { includeOptional: true });
      expect(result.assignments).toEqual([]);
      expect(result.unassigned).toEqual([]);
    }
  });

  it("同じマスに 2 回は割り当てない", () => {
    const result = assign("12月5日、12月6日");

    expect(result.slotIds).toEqual(["scheduleDate:0"]);
    expect(result.bySlot.get("scheduleDate:0")?.text).toBe("12月5日");
    expect(result.unassigned).toEqual(["12月6日"]);
    expect(new Set(result.slotIds).size).toBe(result.slotIds.length);
  });

  it("自由文は欄の語彙が含まれる節だけを受ける", () => {
    const result = assign("忘年会、渋谷ホール");

    expect(result.bySlot.get("title:0")?.text).toBe("忘年会");
    expect(result.bySlot.get("title:0")?.patch).toEqual({ title: "忘年会" });
    expect(result.bySlot.get("venueName:0")?.text).toBe("渋谷ホール");
    expect(result.unassigned).toEqual([]);
  });
});
