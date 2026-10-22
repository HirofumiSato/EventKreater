import { describe, expect, it } from "vitest";
import type { EventStatus } from "@/modules/events/types";
import {
  clampMonth,
  groupOrganizerEventsByDate,
  isPubliclyListed,
  nextScheduleDate,
  organizerProfilePath,
  sortOrganizerEvents,
  toOrganizerCellItem,
  upcomingSchedules,
} from "@/modules/organizers/lib/public-page";

interface TestSchedule {
  id: string;
  eventDate: string;
  eventTime: string;
}

interface TestEvent {
  id: string;
  title: string;
  status: EventStatus;
  isDeleted: boolean;
  rsvpOpen: boolean;
  location: string;
  capacity: number | null;
  attendingCount: number;
  isFull: boolean;
  schedules: TestSchedule[];
}

function schedule(eventDate: string, eventTime = "10:00", id = `${eventDate}-${eventTime}`): TestSchedule {
  return { id, eventDate, eventTime };
}

function event(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    id: "event-1",
    title: "芋煮会",
    status: "PUBLISHED",
    isDeleted: false,
    rsvpOpen: true,
    location: "河原",
    capacity: null,
    attendingCount: 0,
    isFull: false,
    schedules: [schedule("2026-11-01")],
    ...overrides,
  };
}

const TODAY = "2026-10-22";

describe("upcomingSchedules", () => {
  it("今日より前の開催日を落とす", () => {
    const target = event({
      schedules: [schedule("2026-10-21"), schedule("2026-10-22"), schedule("2026-10-23")],
    });

    expect(upcomingSchedules(target, TODAY).map((row) => row.eventDate)).toEqual([
      "2026-10-22",
      "2026-10-23",
    ]);
  });

  it("同じ日の複数の候補日はそのまま残す", () => {
    const target = event({
      schedules: [schedule("2026-11-01", "10:00", "a"), schedule("2026-11-01", "18:00", "b")],
    });

    expect(upcomingSchedules(target, TODAY)).toHaveLength(2);
  });

  it("今日以降が無ければ空になる", () => {
    expect(upcomingSchedules(event({ schedules: [schedule("2026-10-01")] }), TODAY)).toEqual([]);
  });
});

describe("nextScheduleDate", () => {
  it("最も早い今日以降の日を返す", () => {
    const target = event({
      schedules: [schedule("2026-12-24"), schedule("2026-11-03"), schedule("2026-11-01")],
    });

    expect(nextScheduleDate(target, TODAY)).toBe("2026-11-01");
  });

  it("今日も含める", () => {
    expect(nextScheduleDate(event({ schedules: [schedule(TODAY)] }), TODAY)).toBe(TODAY);
  });

  it("過ぎた日しか無ければ null", () => {
    expect(nextScheduleDate(event({ schedules: [schedule("2026-10-21")] }), TODAY)).toBeNull();
  });
});

describe("isPubliclyListed", () => {
  it("公開中で受付中で今日以降の開催日があれば載せる", () => {
    expect(isPubliclyListed(event(), TODAY)).toBe(true);
  });

  it("満員でも載せる（参加要望を受け付けるため）", () => {
    const full = event({ capacity: 10, attendingCount: 10, isFull: true });

    expect(isPubliclyListed(full, TODAY)).toBe(true);
  });

  it("下書きは載せない", () => {
    expect(isPubliclyListed(event({ status: "DRAFT" }), TODAY)).toBe(false);
  });

  it("受付を締め切ったものは載せない", () => {
    expect(isPubliclyListed(event({ rsvpOpen: false }), TODAY)).toBe(false);
  });

  it("削除済みは載せない", () => {
    expect(isPubliclyListed(event({ isDeleted: true }), TODAY)).toBe(false);
  });

  it("今日以降の開催日が無ければ載せない", () => {
    expect(isPubliclyListed(event({ schedules: [schedule("2026-10-01")] }), TODAY)).toBe(false);
  });

  it("候補日が1件も無ければ載せない", () => {
    expect(isPubliclyListed(event({ schedules: [] }), TODAY)).toBe(false);
  });
});

describe("sortOrganizerEvents", () => {
  it("掲載できないものを落とす", () => {
    const rows = [
      event({ id: "published", title: "公開" }),
      event({ id: "draft", title: "下書き", status: "DRAFT" }),
      event({ id: "closed", title: "締切", rsvpOpen: false }),
      event({ id: "past", title: "過去", schedules: [schedule("2026-10-01")] }),
    ];

    expect(sortOrganizerEvents(rows, TODAY).map((row) => row.id)).toEqual(["published"]);
  });

  it("次に開催される日が近い順に並べる", () => {
    const rows = [
      event({ id: "december", title: "十二月", schedules: [schedule("2026-12-01")] }),
      event({ id: "october", title: "十月", schedules: [schedule("2026-10-30")] }),
      event({ id: "november", title: "十一月", schedules: [schedule("2026-11-15")] }),
    ];

    expect(sortOrganizerEvents(rows, TODAY).map((row) => row.id)).toEqual([
      "october",
      "november",
      "december",
    ]);
  });

  it("同じ日なら催し名の五十音順にする", () => {
    const rows = [
      event({ id: "b", title: "ぶどう狩り" }),
      event({ id: "a", title: "あゆ釣り" }),
    ];

    expect(sortOrganizerEvents(rows, TODAY).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("同じ日で同じ名前なら id で決める", () => {
    const rows = [
      event({ id: "z", title: "同名" }),
      event({ id: "a", title: "同名" }),
    ];

    expect(sortOrganizerEvents(rows, TODAY).map((row) => row.id)).toEqual(["a", "z"]);
  });

  it("元の配列を書き換えない", () => {
    const rows = [
      event({ id: "late", title: "遅い", schedules: [schedule("2026-12-01")] }),
      event({ id: "early", title: "早い", schedules: [schedule("2026-11-01")] }),
    ];

    sortOrganizerEvents(rows, TODAY);

    expect(rows.map((row) => row.id)).toEqual(["late", "early"]);
  });
});

describe("groupOrganizerEventsByDate", () => {
  it("候補日ごとに同じ催しを置く", () => {
    const rows = [
      event({
        id: "multi",
        title: "連続開催",
        schedules: [schedule("2026-11-01", "10:00", "one"), schedule("2026-11-02", "10:00", "two")],
      }),
    ];

    const grouped = groupOrganizerEventsByDate(rows, TODAY);

    expect([...grouped.keys()]).toEqual(["2026-11-01", "2026-11-02"]);
    expect(grouped.get("2026-11-01")?.[0].schedule.eventDate).toBe("2026-11-01");
    expect(grouped.get("2026-11-02")?.[0].schedule.eventDate).toBe("2026-11-02");
  });

  it("過ぎた候補日の催しは出さない", () => {
    const rows = [event({ schedules: [schedule("2026-10-01")] })];

    expect(groupOrganizerEventsByDate(rows, TODAY).size).toBe(0);
  });

  it("同じ日は時刻順、同時刻は催し名の五十音順にする", () => {
    const rows = [
      event({ id: "night", title: "夜の部", schedules: [schedule("2026-11-01", "18:00")] }),
      event({ id: "morning-b", title: "ぶどう", schedules: [schedule("2026-11-01", "10:00")] }),
      event({ id: "morning-a", title: "あゆ", schedules: [schedule("2026-11-01", "10:00")] }),
    ];

    const day = groupOrganizerEventsByDate(rows, TODAY).get("2026-11-01");

    expect(day?.map((entry) => entry.event.id)).toEqual(["morning-a", "morning-b", "night"]);
  });

  it("時刻未定は同じ日の最後に置く", () => {
    const rows = [
      event({ id: "unknown", title: "未定", schedules: [schedule("2026-11-01", "")] }),
      event({ id: "timed", title: "時刻あり", schedules: [schedule("2026-11-01", "09:00")] }),
    ];

    const day = groupOrganizerEventsByDate(rows, TODAY).get("2026-11-01");

    expect(day?.map((entry) => entry.event.id)).toEqual(["timed", "unknown"]);
  });
});

describe("toOrganizerCellItem", () => {
  it("空きがあれば通常の色にする", () => {
    const item = toOrganizerCellItem({
      event: { id: "event-1", title: "芋煮会", location: "河原", isFull: false, capacity: 20, attendingCount: 5 },
      schedule: { eventTime: "10:00" },
    });

    expect(item.key).toBe("event-1:10:00");
    expect(item.tone).toBe("default");
    expect(item.href).toBe("/events/event-1");
    expect(item.detail).toBe("10:00 · 河原 · 5/20名");
  });

  it("満員なら参加要望の色にする", () => {
    const item = toOrganizerCellItem({
      event: { id: "event-1", title: "芋煮会", location: "河原", isFull: true, capacity: 10, attendingCount: 10 },
      schedule: { eventTime: "10:00" },
    });

    expect(item.tone).toBe("waitlist");
  });

  it("定員なしなら参加人数だけを出す", () => {
    const item = toOrganizerCellItem({
      event: { id: "event-1", title: "芋煮会", location: "", isFull: false, capacity: null, attendingCount: 3 },
      schedule: { eventTime: "" },
    });

    expect(item.detail).toBe("時刻未定 · 3名");
  });
});

describe("clampMonth", () => {
  it("下限より前は下限へ寄せる", () => {
    expect(clampMonth("2026-09", "2026-10")).toBe("2026-10");
  });

  it("下限と同じならそのまま", () => {
    expect(clampMonth("2026-10", "2026-10")).toBe("2026-10");
  });

  it("未来の月はそのまま", () => {
    expect(clampMonth("2027-01", "2026-10")).toBe("2027-01");
  });

  it("壊れた値は下限へ寄せる", () => {
    expect(clampMonth(null, "2026-10")).toBe("2026-10");
    expect(clampMonth("", "2026-10")).toBe("2026-10");
    expect(clampMonth("2026-13", "2026-10")).toBe("2026-10");
    expect(clampMonth("next", "2026-10")).toBe("2026-10");
  });
});

describe("organizerProfilePath", () => {
  it("主催者の公開ページの URL を組み立てる", () => {
    expect(organizerProfilePath("user-123")).toBe("/organizers/user-123");
  });
});
