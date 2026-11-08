// @vitest-environment jsdom
//
// 告知ページの「料金」欄。編集画面の「プラン1」「プラン2」と対応させる。
//
// 見るのは 3 つ。
//   1. 共通料金を 2 件以上並べたら、プランごとに「プラン1」「プラン2」で区切る
//   2. 男女別は 1 組＝1 プラン。組の見出しにプラン名を 1 回だけ出し、対象ごとの金額を下に並べる
//   3. プランが 1 つだけなら番号を出さない（分ける必要がないため）

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EventMetaCard } from "@/modules/events/components/EventMetaCard";
import type { EventPricePlanOption } from "@/modules/events/types";

afterEach(cleanup);

type MetaEvent = ComponentProps<typeof EventMetaCard>["event"];

function plan(
  id: string,
  name: string,
  amount: number,
  audience: EventPricePlanOption["audience"] = "ANY",
  note: string | null = null,
): EventPricePlanOption {
  return {
    id,
    name,
    audience,
    amount,
    note,
    price: note ? `${amount.toLocaleString("ja-JP")}円（${note}）` : `${amount.toLocaleString("ja-JP")}円`,
  };
}

function metaEvent(pricePlans: EventPricePlanOption[]): MetaEvent {
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
    pricePlans,
    discounts: [],
    location: "河川敷公園 第2広場（東京都世田谷区）",
    rainPolicy: "RAIN_OR_SHINE",
    capacity: 40,
    targetGeneration: null,
    attendingCount: 13,
    status: "PUBLISHED",
    rsvpDeadline: null,
    rsvpOpen: true,
    organizers: { owner: { name: "佐藤 みのり", userId: null }, coHosts: [] },
  };
}

/** 「料金」の行だけを取り出す。日時や場所の行と混ざらないようにする。 */
function priceRow(container: HTMLElement): HTMLElement {
  const row = Array.from(container.querySelectorAll(".event-facts__row")).find(
    (element) => element.querySelector("dt")?.textContent === "料金",
  );
  if (!row) throw new Error("料金の行が見つかりません");
  return row as HTMLElement;
}

describe("告知ページの料金", () => {
  it("共通料金はプランごとに「プラン1」「プラン2」で区切る", () => {
    const { container } = render(
      <EventMetaCard
        event={metaEvent([
          plan("plan-1", "一般", 3000, "ANY", "1ドリンク付"),
          plan("plan-2", "学生", 2000),
        ])}
      />,
    );

    const row = priceRow(container);
    expect(within(row).getByText("プラン1")).toBeTruthy();
    expect(within(row).getByText("プラン2")).toBeTruthy();
    expect(row.textContent).toContain("一般 3,000円（1ドリンク付）");
    expect(row.textContent).toContain("学生 2,000円");
  });

  it("男女別は組の見出しにプラン名を 1 回だけ出し、対象ごとの金額を下に並べる", () => {
    const { container } = render(
      <EventMetaCard
        event={metaEvent([
          plan("male-1", "一般", 3000, "MALE"),
          plan("female-1", "一般", 2500, "FEMALE"),
          plan("male-2", "学生", 2000, "MALE"),
          plan("female-2", "学生", 1500, "FEMALE"),
        ])}
      />,
    );

    const row = priceRow(container);
    expect(within(row).getByText("プラン1")).toBeTruthy();
    expect(within(row).getByText("プラン2")).toBeTruthy();
    // プラン名は組の見出しに 1 回だけ。行ごとに繰り返さない。
    expect(within(row).getAllByText("一般")).toHaveLength(1);
    expect(within(row).getAllByText("学生")).toHaveLength(1);
    expect(row.textContent).toContain("男性：3,000円");
    expect(row.textContent).toContain("女性：2,500円");
    expect(row.textContent).toContain("男性：2,000円");
    expect(row.textContent).toContain("女性：1,500円");
  });

  it("プランが 1 つだけなら番号を出さない", () => {
    const { container } = render(<EventMetaCard event={metaEvent([plan("plan-1", "一般", 3000)])} />);

    const row = priceRow(container);
    expect(within(row).queryByText(/プラン\d/)).toBeNull();
    expect(row.textContent).toContain("一般 3,000円");
  });

  it("片側だけ残った古い組は、対象を添えて 1 行で出す", () => {
    const { container } = render(
      <EventMetaCard event={metaEvent([plan("male-1", "一般", 4500, "MALE")])} />,
    );

    const row = priceRow(container);
    expect(row.textContent).toContain("男性：一般 4,500円");
  });

  it("組の中でプラン名が食い違うときは、行ごとに名前を出す", () => {
    const { container } = render(
      <EventMetaCard
        event={metaEvent([plan("male-1", "一般", 3000, "MALE"), plan("female-1", "女性一般", 2500, "FEMALE")])}
      />,
    );

    const row = priceRow(container);
    expect(row.textContent).toContain("男性：一般 3,000円");
    expect(row.textContent).toContain("女性：女性一般 2,500円");
  });
});
