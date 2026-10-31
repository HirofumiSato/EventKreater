import { describe, expect, it } from "vitest";
import {
  countMonthEntries,
  defaultSelectedDate,
  entriesForDate,
  splitCellItems,
} from "@/lib/calendar";
import {
  groupParticipantEntriesByDate,
  sortParticipantDayEntries,
  toParticipantCellItem,
} from "@/modules/participants/lib/calendar";
import { participationCalendarDate } from "@/modules/participants/lib/participations";
import type { ParticipantCalendarEntry } from "@/modules/participants/types";
import { groupSchedulesByDate, toOrganizerCellItem } from "@/modules/organizers/lib/calendar";
import type { EventScheduleOption, OrganizerEvent } from "@/modules/events/types";

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
    discounts: [],
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
    quotaSource: "SUBSCRIPTION",
    ownerName: "主催者",
    ownerUserId: null,
    stats: { attendingCount: 0, declinedCount: 0, waitlistedCount: 0, totalResponses: 0 },
    flyerThumbnailUrl: null,
    flyerAsset: null,
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<ParticipantCalendarEntry> = {},
): ParticipantCalendarEntry {
  return {
    participantId: "participant-1",
    date: "2026-10-22",
    eventTime: "18:00〜21:00",
    status: "ATTENDING",
    statusLabel: "出席",
    event: {
      id: "event-1",
      title: "芋煮会",
      location: "河原",
      status: "PUBLISHED",
      flyerThumbnailUrl: null,
    },
    ...overrides,
  };
}

describe("participationCalendarDate", () => {
  it("出欠で選んだ日程の日付を使う", () => {
    expect(
      participationCalendarDate({
        schedule: { eventDate: new Date("2026-10-24T00:00:00.000Z") },
        event: { sortDate: new Date("2026-10-22T00:00:00.000Z") },
      }),
    ).toBe("2026-10-24");
  });

  it("日程を選んでいなければイベントの代表日に置く", () => {
    expect(
      participationCalendarDate({
        schedule: null,
        event: { sortDate: new Date("2026-10-22T00:00:00.000Z") },
      }),
    ).toBe("2026-10-22");
  });
});

describe("groupParticipantEntriesByDate", () => {
  it("出欠の1件を、その日付にだけ置く", () => {
    const grouped = groupParticipantEntriesByDate([
      makeEntry({ participantId: "p1", date: "2026-10-22" }),
      makeEntry({ participantId: "p2", date: "2026-10-24" }),
      makeEntry({ participantId: "p3", date: "2026-11-01" }),
    ]);
    expect(grouped.get("2026-10-22")).toHaveLength(1);
    expect(grouped.get("2026-10-24")).toHaveLength(1);
    expect(grouped.get("2026-11-01")).toHaveLength(1);
    expect(entriesForDate(grouped, "2026-10-23")).toEqual([]);
  });

  it("同じ日の出席と欠席を、時刻順に並べる", () => {
    const evening = makeEntry({
      participantId: "evening",
      date: "2026-10-22",
      eventTime: "18:00〜21:00",
      event: {
        id: "event-evening",
        title: "懇親会",
        location: "居酒屋",
        status: "PUBLISHED",
        flyerThumbnailUrl: null,
      },
    });
    const morning = makeEntry({
      participantId: "morning",
      date: "2026-10-22",
      eventTime: "10:00〜12:00",
      status: "DECLINED",
      statusLabel: "欠席",
    });
    const grouped = groupParticipantEntriesByDate([evening, morning]);
    expect(grouped.get("2026-10-22")?.map((entry) => entry.participantId)).toEqual([
      "morning",
      "evening",
    ]);
  });

  it("時刻の無い催しは末尾に置き、同時刻は催し名で揃える", () => {
    const noTime = makeEntry({
      participantId: "no-time",
      date: "2026-10-22",
      eventTime: "",
      event: {
        id: "event-no-time",
        title: "朝会",
        location: "公園",
        status: "PUBLISHED",
        flyerThumbnailUrl: null,
      },
    });
    const sameTimeB = makeEntry({
      participantId: "same-b",
      date: "2026-10-22",
      event: {
        id: "event-b",
        title: "バーベキュー",
        location: "河原",
        status: "PUBLISHED",
        flyerThumbnailUrl: null,
      },
    });
    const sameTimeA = makeEntry({
      participantId: "same-a",
      date: "2026-10-22",
      event: {
        id: "event-a",
        title: "あさひ会",
        location: "公民館",
        status: "PUBLISHED",
        flyerThumbnailUrl: null,
      },
    });
    const sorted = sortParticipantDayEntries([noTime, sameTimeB, sameTimeA]);
    expect(sorted.map((entry) => entry.participantId)).toEqual([
      "same-a",
      "same-b",
      "no-time",
    ]);
  });
});

describe("月の集計", () => {
  it("月外の出欠を数えない", () => {
    const grouped = groupParticipantEntriesByDate([
      makeEntry({ participantId: "p1", date: "2026-09-30" }),
      makeEntry({ participantId: "p2", date: "2026-10-01" }),
      makeEntry({ participantId: "p3", date: "2026-10-31" }),
      makeEntry({ participantId: "p4", date: "2026-11-01" }),
    ]);
    expect(countMonthEntries(grouped, "2026-10")).toBe(2);
  });

  it("今月を開いたときは今日を、別の月なら1日を選ぶ", () => {
    const today = new Date();
    const shifted = new Date(today.getTime() + 9 * 60 * 60 * 1000);
    const todayKey = shifted.toISOString().slice(0, 10);
    const month = todayKey.slice(0, 7);
    expect(defaultSelectedDate(month)).toBe(todayKey);
    expect(defaultSelectedDate("2020-01")).toBe("2020-01-01");
  });
});

describe("セルに入れる予定", () => {
  it("3件まではそのまま出し、はみ出すときは「+N」込みで3行に収める", () => {
    expect(splitCellItems(["a", "b"])).toEqual({ visible: ["a", "b"], overflow: 0 });
    expect(splitCellItems(["a", "b", "c"])).toEqual({ visible: ["a", "b", "c"], overflow: 0 });
    expect(splitCellItems(["a", "b", "c", "d"])).toEqual({
      visible: ["a", "b"],
      overflow: 2,
    });
    expect(splitCellItems(["a", "b", "c", "d", "e"])).toEqual({
      visible: ["a", "b"],
      overflow: 3,
    });
  });

  it("予定が無い日は空で返す", () => {
    expect(splitCellItems([])).toEqual({ visible: [], overflow: 0 });
  });

  it("その日の予定を催し名の短冊に写し、欠席は控えめにする", () => {
    const event = makeEvent({
      schedules: [
        makeSchedule("s1", "2026-10-22", "18:00", "21:00"),
        makeSchedule("s2", "2026-10-22", "09:00", "10:00"),
      ],
    });
    const items = entriesForDate(groupSchedulesByDate([event]), "2026-10-22").map(
      toOrganizerCellItem,
    );
    // 09:00 が先。欠席は無いので、両方とも通常の色。
    expect(items[0].key).toBe("event-1-s2");
    expect(items[0].tone).toBe("default");
    expect(items[0].title).toBe("芋煮会");
  });
});

describe("セルを押したときのモーダル", () => {
  it("参加者は時刻・出欠・場所と、催しページのリンクを持つ", () => {
    const item = toParticipantCellItem(makeEntry());
    expect(item).toEqual({
      key: "participant-1",
      title: "芋煮会",
      tone: "default",
      detail: "18:00〜21:00 · 出席 · 河原",
      href: "/events/event-1",
    });
  });

  it("参加者の欠席は控えめな色にし、場所が無ければ詰めて出す", () => {
    const item = toParticipantCellItem(
      makeEntry({
        status: "DECLINED",
        statusLabel: "欠席",
        eventTime: "",
        event: {
          id: "event-9",
          title: "休日の集まり",
          location: "",
          status: "PUBLISHED",
          flyerThumbnailUrl: null,
        },
      }),
    );
    expect(item.tone).toBe("muted");
    expect(item.detail).toBe("時刻未定 · 欠席");
    expect(item.href).toBe("/events/event-9");
  });

  it("主催者は公開中なら催しページ、下書きなら編集画面へ送る", () => {
    const schedule = makeSchedule("s1", "2026-10-22", "18:00", "21:00");
    expect(toOrganizerCellItem({ event: makeEvent(), schedule })).toEqual({
      key: "event-1-s1",
      title: "芋煮会",
      tone: "default",
      detail: "18:00〜21:00 · 公開中",
      href: "/organizer/events/event-1/participants",
    });
    expect(
      toOrganizerCellItem({ event: makeEvent({ status: "DRAFT" }), schedule }).href,
    ).toBe("/organizer/events/event-1/edit");
  });
});
