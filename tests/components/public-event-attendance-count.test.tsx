// @vitest-environment jsdom
//
// 告知ページの参加人数。集まりはじめの少ない人数を見せると「まだ空いている」と映り、
// 申し込みの腰を折る。定員の半分を超えるまでは、人数（と残席）を出さない。
//
// 見るのは 3 つ。
//   1. 半分以下のときは「参加」の行を出さず、定員だけを札で示す
//   2. 半分を超えたら人数・定員・残席を出す
//   3. 画面下の帯も同じ境目で切り替える

import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EventMetaCard } from "@/modules/events/components/EventMetaCard";
import { StickyRsvpBar } from "@/modules/attendance/components/StickyRsvpBar";

afterEach(cleanup);

type MetaEvent = ComponentProps<typeof EventMetaCard>["event"];

function metaEvent(capacity: number | null, attendingCount: number): MetaEvent {
  return {
    title: "秋の芋煮会",
    summary: null,
    schedules: [
      {
        id: "schedule-1",
        eventDate: "2026-12-08",
        startTime: "11:00",
        endTime: "15:00",
        eventTime: "11:00〜15:00",
      },
    ],
    pricePlans: [],
    discounts: [],
    location: "河川敷公園 第2広場（東京都世田谷区）",
    rainPolicy: "RAIN_OR_SHINE",
    capacity,
    targetGeneration: null,
    attendingCount,
    status: "PUBLISHED",
    rsvpDeadline: null,
    rsvpOpen: true,
    organizers: { owner: { name: "佐藤 みのり", userId: null }, coHosts: [] },
  };
}

/** 「参加」の行の本文。行が無ければ null。 */
function attendanceRowText(container: HTMLElement): string | null {
  const row = Array.from(container.querySelectorAll(".event-facts__row")).find(
    (element) => element.querySelector("dt")?.textContent === "参加",
  );
  return row?.querySelector("dd")?.textContent ?? null;
}

function renderBar(capacity: number | null, attendingCount: number) {
  return render(
    <StickyRsvpBar
      attendingCount={attendingCount}
      waitlistCount={0}
      capacity={capacity}
      answered={false}
      closed={false}
      onOpen={() => {}}
    />,
  );
}

describe("告知ページの参加人数", () => {
  it("定員の半分以下のときは「参加」の行を出さない", () => {
    const { container, queryByText } = render(<EventMetaCard event={metaEvent(40, 13)} />);

    expect(attendanceRowText(container)).toBeNull();
    // 定員そのものは札が示す（人数は読み取れない）。
    expect(queryByText("定員 40名")).toBeTruthy();
  });

  it("定員の半分を超えたら人数・定員・残席を出す", () => {
    const { container } = render(<EventMetaCard event={metaEvent(40, 25)} />);

    expect(attendanceRowText(container)).toBe("25名 / 定員 40名（残り 15名）");
  });

  it("定員が無い催しは、これまでどおり人数を出す", () => {
    const { container } = render(<EventMetaCard event={metaEvent(null, 3)} />);

    expect(attendanceRowText(container)).toBe("3名");
  });

  it("画面下の帯も、半分を超えるまでは定員だけを出す", () => {
    const { container } = renderBar(40, 13);

    const text = container.querySelector(".sticky-rsvp .help")?.textContent ?? "";
    expect(text).toBe("定員 40名");
    expect(text).not.toContain("参加");
  });

  it("画面下の帯は、半分を超えたら人数を出す", () => {
    const { container } = renderBar(40, 25);

    expect(container.querySelector(".sticky-rsvp .help")?.textContent).toBe(
      "参加 25名 / 定員 40名",
    );
  });
});
