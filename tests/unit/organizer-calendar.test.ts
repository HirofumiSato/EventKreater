import { describe, expect, it } from "vitest";
import type { EventScheduleOption, OrganizerEvent } from "@/modules/events/types";
import {
  buildMonthGrid,
  countMonthEntries,
  currentMonth,
  entriesForDate,
  formatCellLabel,
  formatDayHeading,
  groupSchedulesByDate,
  isMonthKey,
  monthRange,
  shiftMonth,
  sortDayEntries,
  todayInTokyo,
} from "@/modules/organizers/lib/calendar";

function makeSchedule(
  id: string,
  eventDate: string,
  startTime: string | null = null,
  endTime: string | null = null,
): EventScheduleOption {
  return {
    id,
    eventDate,
    startTime,
    endTime,
    eventTime: startTime && endTime ? `${startTime}〜${endTime}` : (startTime ?? ""),
  };
}

function makeEvent(overrides: Partial<OrganizerEvent> = {}): OrganizerEvent {
  return {
    id: "event-1",
    title: "芋煮会",
    sortDate: "2026-10-22",
    schedules: [],
    pricePlans: [],
    location: "河原",
    rainPolicy: "RAIN_OR_SHINE",
    capacity: null,
    status: "PUBLISHED",
    visibility: "UNLISTED",
    rsvpDeadline: null,
    rsvpOpen: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    flyerAssetId: null,
    role: "OWNER",
    ownerName: "主催者",
    stats: { attendingCount: 0, declinedCount: 0, totalResponses: 0 },
    flyerThumbnailUrl: null,
    flyerAsset: null,
    ...overrides,
  };
}

describe("今日と今月（日本時間）", () => {
  it("UTC の日付が前日でも、日本時間の日付で返す", () => {
    // 2026-10-21 16:00 UTC = 2026-10-22 01:00 JST
    expect(todayInTokyo(new Date("2026-10-21T16:00:00.000Z"))).toBe("2026-10-22");
    expect(currentMonth(new Date("2026-10-21T16:00:00.000Z"))).toBe("2026-10");
  });

  it("月末の深夜は翌月として扱う", () => {
    // 2026-10-31 15:30 UTC = 2026-11-01 00:30 JST
    expect(currentMonth(new Date("2026-10-31T15:30:00.000Z"))).toBe("2026-11");
  });

  it("月の表記は YYYY-MM だけを受け付ける", () => {
    expect(isMonthKey("2026-10")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-1")).toBe(false);
    expect(isMonthKey("2026-10-22")).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });
});

describe("shiftMonth", () => {
  it("年をまたいで前後に動く", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 3)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("不正な値はそのまま返す", () => {
    expect(shiftMonth("2026-13", 1)).toBe("2026-13");
  });
});

describe("monthRange", () => {
  it("月初・月末・日数を返す", () => {
    expect(monthRange("2026-10")).toEqual({ start: "2026-10-01", end: "2026-10-31", days: 31 });
  });

  it("うるう年の2月を正しく扱う", () => {
    expect(monthRange("2026-02").days).toBe(28);
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29", days: 29 });
  });
});

describe("buildMonthGrid", () => {
  it("日曜始まりの42日で、月内の日だけ isOutside が false になる", () => {
    const cells = buildMonthGrid("2026-10");
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe("2026-09-27");
    expect(cells[0].isOutside).toBe(true);
    expect(cells[cells.length - 1].date).toBe("2026-11-07");
    expect(cells.filter((cell) => !cell.isOutside)).toHaveLength(31);
    expect(cells.find((cell) => cell.date === "2026-10-01")?.isOutside).toBe(false);
    expect(cells.find((cell) => cell.date === "2026-10-31")?.isOutside).toBe(false);
  });

  it("6週にまたがる月でも42日で固定する", () => {
    // 2026-08-01 は土曜。前月6日ぶんから始まる。
    const cells = buildMonthGrid("2026-08");
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe("2026-07-26");
    expect(cells.filter((cell) => !cell.isOutside)).toHaveLength(31);
  });

  it("先頭のセルは必ず日曜になる", () => {
    for (const month of ["2026-01", "2026-02", "2026-08", "2027-05"]) {
      const first = buildMonthGrid(month)[0].date;
      const weekday = new Date(`${first}T00:00:00.000Z`).getUTCDay();
      expect(weekday).toBe(0);
    }
  });
});

describe("groupSchedulesByDate", () => {
  it("複数の開催日を持つ催しを、すべての日付に1件ずつ出す", () => {
    const event = makeEvent({
      schedules: [
        makeSchedule("s1", "2026-10-22", "18:00", "21:00"),
        makeSchedule("s2", "2026-10-24", "10:00", "12:00"),
        makeSchedule("s3", "2026-11-01", "13:00", "15:00"),
      ],
    });
    const grouped = groupSchedulesByDate([event]);
    expect(grouped.get("2026-10-22")).toHaveLength(1);
    expect(grouped.get("2026-10-24")).toHaveLength(1);
    expect(grouped.get("2026-11-01")).toHaveLength(1);
    expect(entriesForDate(grouped, "2026-10-23")).toEqual([]);
  });

  it("同じ日に複数の催しがあれば、まとめて時刻順にする", () => {
    const later = makeEvent({
      id: "event-later",
      schedules: [makeSchedule("s2", "2026-10-22", "18:00", "21:00")],
    });
    const earlier = makeEvent({
      id: "event-earlier",
      createdAt: "2026-09-01T00:00:00.000Z",
      schedules: [makeSchedule("s1", "2026-10-22", "10:00", "12:00")],
    });
    const grouped = groupSchedulesByDate([later, earlier]);
    expect(grouped.get("2026-10-22")?.map((entry) => entry.event.id)).toEqual([
      "event-earlier",
      "event-later",
    ]);
  });

  it("時刻の無い催しは末尾に置き、同時刻は作成順にする", () => {
    const noTime = makeEvent({ id: "no-time", schedules: [makeSchedule("s0", "2026-10-22")] });
    const second = makeEvent({
      id: "second",
      createdAt: "2026-10-02T00:00:00.000Z",
      schedules: [makeSchedule("s2", "2026-10-22", "18:00", "21:00")],
    });
    const first = makeEvent({
      id: "first",
      createdAt: "2026-10-01T00:00:00.000Z",
      schedules: [makeSchedule("s1", "2026-10-22", "18:00", "21:00")],
    });
    const sorted = sortDayEntries(
      groupSchedulesByDate([noTime, second, first]).get("2026-10-22") ?? [],
    );
    expect(sorted.map((entry) => entry.event.id)).toEqual(["first", "second", "no-time"]);
  });
});

describe("countMonthEntries", () => {
  it("月外の予定を数えない", () => {
    const event = makeEvent({
      schedules: [
        makeSchedule("s1", "2026-09-30", "18:00", "21:00"),
        makeSchedule("s2", "2026-10-01", "18:00", "21:00"),
        makeSchedule("s3", "2026-10-31", "18:00", "21:00"),
        makeSchedule("s4", "2026-11-01", "18:00", "21:00"),
      ],
    });
    expect(countMonthEntries(groupSchedulesByDate([event]), "2026-10")).toBe(2);
  });
});

describe("表示文言", () => {
  it("見出しは月日と曜日を出す", () => {
    expect(formatDayHeading("2026-10-22")).toBe("10月22日（木）");
    expect(formatDayHeading("2026-10-25")).toBe("10月25日（日）");
  });

  it("セルの読み上げに件数を入れる", () => {
    expect(formatCellLabel("2026-10-22", 2)).toBe("10月22日、予定2件");
    expect(formatCellLabel("2026-10-22", 0)).toBe("10月22日、予定なし");
  });
});
