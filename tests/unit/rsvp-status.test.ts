import { describe, expect, it } from "vitest";
import {
  isFull,
  isWaitlisted,
  nextRsvpChoices,
  remainingSeats,
  rsvpStatusLabel,
  rsvpStatusTone,
  sortWaitlistRows,
  waitlistPosition,
} from "@/modules/events/lib/rsvp-status";

describe("remainingSeats / isFull", () => {
  it("定員が無ければ残りは分からない", () => {
    expect(remainingSeats(null, 99)).toBeNull();
    expect(isFull(null, 99)).toBe(false);
  });

  it("定員ちょうどで満員、超過しても負にしない", () => {
    expect(remainingSeats(5, 3)).toBe(2);
    expect(remainingSeats(5, 5)).toBe(0);
    expect(remainingSeats(5, 8)).toBe(0);
    expect(isFull(5, 5)).toBe(true);
    expect(isFull(5, 4)).toBe(false);
  });
});

describe("nextRsvpChoices", () => {
  it("空きがあれば出席を選べる", () => {
    const choices = nextRsvpChoices({ capacity: 5, attendingCount: 3, myStatus: null });
    expect(choices).toEqual({ attend: true, waitlist: false, mode: "open" });
  });

  it("満員なら参加要望を出す", () => {
    const choices = nextRsvpChoices({ capacity: 5, attendingCount: 5, myStatus: null });
    expect(choices).toEqual({ attend: false, waitlist: true, mode: "full" });
  });

  it("席を確保済みの出席者は、満員でも出席のまま変更できる", () => {
    const choices = nextRsvpChoices({ capacity: 5, attendingCount: 6, myStatus: "ATTENDING" });
    expect(choices).toEqual({ attend: true, waitlist: false, mode: "attending" });
  });

  it("要望している人は、空きが出れば出席へ変えられる", () => {
    const choices = nextRsvpChoices({ capacity: 5, attendingCount: 4, myStatus: "WAITLISTED" });
    expect(choices.attend).toBe(true);
    expect(choices.mode).toBe("open");
  });

  it("要望している人でも、満員のままなら要望のまま", () => {
    const choices = nextRsvpChoices({ capacity: 5, attendingCount: 5, myStatus: "WAITLISTED" });
    expect(choices.mode).toBe("full");
  });

  it("定員が無いイベントは常に出席を選べる", () => {
    const choices = nextRsvpChoices({ capacity: null, attendingCount: 100, myStatus: null });
    expect(choices.attend).toBe(true);
    expect(choices.mode).toBe("open");
  });
});

describe("sortWaitlistRows / waitlistPosition", () => {
  const rows = [
    { id: "c", status: "WAITLISTED" as const, waitlistedAt: "2026-10-22T03:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "a", status: "WAITLISTED" as const, waitlistedAt: "2026-10-22T01:00:00.000Z", createdAt: "2026-10-05T00:00:00.000Z" },
    { id: "b", status: "WAITLISTED" as const, waitlistedAt: "2026-10-22T01:00:00.000Z", createdAt: "2026-10-02T00:00:00.000Z" },
  ];

  it("要望日時の古い順に並べ、同時刻は作成日時で決める", () => {
    expect(sortWaitlistRows(rows).map((row) => row.id)).toEqual(["b", "a", "c"]);
  });

  it("元の配列は変えない", () => {
    const before = rows.map((row) => row.id);
    sortWaitlistRows(rows);
    expect(rows.map((row) => row.id)).toEqual(before);
  });

  it("待ち順は1始まり。要望でない人は数えない", () => {
    const mixed = [
      { id: "x", status: "ATTENDING" as const, waitlistedAt: null, createdAt: "2026-10-01T00:00:00.000Z" },
      ...rows,
    ];
    expect(waitlistPosition(mixed, "b")).toBe(1);
    expect(waitlistPosition(mixed, "x")).toBeNull();
    expect(waitlistPosition(mixed, "missing")).toBeNull();
  });

  it("要望日時が無い行は作成日時で代用する", () => {
    const legacy = [
      { id: "new", status: "WAITLISTED" as const, waitlistedAt: null, createdAt: "2026-10-10T00:00:00.000Z" },
      { id: "old", status: "WAITLISTED" as const, waitlistedAt: null, createdAt: "2026-10-01T00:00:00.000Z" },
    ];
    expect(sortWaitlistRows(legacy).map((row) => row.id)).toEqual(["old", "new"]);
  });
});

describe("ラベルと色", () => {
  it("3状態に文言と色が付く", () => {
    expect(rsvpStatusLabel("ATTENDING")).toBe("出席");
    expect(rsvpStatusLabel("DECLINED")).toBe("欠席");
    expect(rsvpStatusLabel("WAITLISTED")).toBe("参加要望中");
    expect(rsvpStatusTone("WAITLISTED")).toBe("waitlist");
    expect(isWaitlisted("WAITLISTED")).toBe(true);
    expect(isWaitlisted("ATTENDING")).toBe(false);
  });
});
