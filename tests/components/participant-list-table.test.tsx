// @vitest-environment jsdom
//
// 名簿（`ParticipantListTable`）の人数まわりの再発防止。
//
//   1. 人数は出席のときだけ出す。欠席・参加要望は席を取らないので「—」
//   2. 支払額は 1 人ぶんと人数ぶんの合計を並べる（領収書は 1 人ずつ切る）
//   3. 参加要望の承認は人数の入力から始まる（要望のままでは人数を出さない）
//   4. 出席なのに日時が 0 件なら保存させない

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantListTable } from "@/modules/attendance/components/ParticipantListTable";
import type {
  EventPricePlanOption,
  EventScheduleOption,
  ParticipantRow,
} from "@/modules/events/types";

function plan(id: string, amount: number): EventPricePlanOption {
  return {
    id,
    name: `プラン${id}`,
    audience: "ANY",
    amount,
    note: null,
    price: `${amount.toLocaleString("ja-JP")}円`,
  };
}

function schedule(id: string, eventDate: string): EventScheduleOption {
  return {
    id,
    eventDate,
    startTime: "13:00",
    endTime: "21:00",
    eventTime: "13:00〜21:00",
  };
}

function participant(overrides: Partial<ParticipantRow> & { id: string }): ParticipantRow {
  const { id, ...rest } = overrides;
  const partySize = rest.partySize ?? 1;
  const unitPayableAmount = rest.unitPayableAmount ?? 2500;
  return {
    id,
    name: "佐藤 みのり",
    status: "ATTENDING",
    gender: null,
    comment: null,
    scheduleId: "s1",
    scheduleIds: ["s1"],
    partySize,
    pricePlanId: "p1",
    scheduleLabel: "2026-11-21 13:00〜21:00",
    pricePlanLabel: "プランp1",
    pricePlanAmount: 3000,
    discounts: [
      { discountId: "d1", name: "早割", amount: 500, note: null, label: "早割 -500円" },
    ],
    discountAmount: 500 * partySize,
    payableAmount: unitPayableAmount * partySize,
    unitPayableAmount,
    createdAt: new Date("2026-11-01T03:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-11-01T03:00:00.000Z").toISOString(),
    waitlistedAt: null,
    waitlistPosition: null,
    receipt: null,
    ...rest,
  };
}

const SCHEDULES = [schedule("s1", "2026-11-21"), schedule("s2", "2026-11-22")];
const PLANS = [plan("p1", 3000)];

function renderTable(rows: ParticipantRow[], onSave = vi.fn<(input: unknown) => Promise<void>>(async () => {})) {
  return {
    onSave,
    ...render(
      <ParticipantListTable
        rows={rows}
        schedules={SCHEDULES}
        pricePlans={PLANS}
        attendingCount={rows.filter((row) => row.status === "ATTENDING").length}
        declinedCount={rows.filter((row) => row.status === "DECLINED").length}
        waitlistedCount={rows.filter((row) => row.status === "WAITLISTED").length}
        onSave={onSave}
      />,
    ),
  };
}

afterEach(() => {
  cleanup();
});

describe("人数の列", () => {
  it("出席は人数を出し、欠席と参加要望は「—」にする", () => {
    const { container } = renderTable([
      participant({ id: "a", partySize: 3, payableAmount: 7500 }),
      participant({ id: "b", name: "欠席さん", status: "DECLINED", partySize: 1 }),
      participant({ id: "c", name: "要望さん", status: "WAITLISTED", partySize: 1 }),
    ]);
    const partyCells = Array.from(container.querySelectorAll("tbody tr")).map(
      (tr) => tr.querySelectorAll("td")[3].textContent,
    );
    expect(partyCells).toEqual(["3人", "—", "—"]);
  });

  it("2 人以上は 1 人ぶんの金額と合計を並べる", () => {
    renderTable([
      participant({ id: "a", partySize: 3, unitPayableAmount: 2500, payableAmount: 7500 }),
    ]);
    expect(screen.getByText("1人 2,500円")).toBeTruthy();
    expect(screen.getByText("3人 合計 7,500円")).toBeTruthy();
  });

  it("1 人なら支払額だけを出し、合計は書かない", () => {
    renderTable([participant({ id: "a", partySize: 1, unitPayableAmount: 2500, payableAmount: 2500 })]);
    expect(screen.getByText("支払額 2,500円")).toBeTruthy();
  });
});

describe("参加要望の承認", () => {
  it("承認すると人数の入力が出て、出席で保存する", async () => {
    const waitlisted = participant({
      id: "w",
      name: "要望さん",
      status: "WAITLISTED",
      waitlistedAt: new Date("2026-11-01T04:00:00.000Z").toISOString(),
      waitlistPosition: 1,
      pricePlanId: null,
      pricePlanLabel: null,
      pricePlanAmount: null,
      discounts: [],
      discountAmount: 0,
      payableAmount: null,
      unitPayableAmount: null,
    });
    const { onSave } = renderTable([waitlisted]);

    // 要望のままでは人数の欄は出ない。
    expect(document.querySelector(".roster__party-size")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "承認" }));
    const input = document.querySelector<HTMLInputElement>(".roster__party-size");
    expect(input).toBeTruthy();

    fireEvent.change(input!, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ id: "w", status: "ATTENDING", partySize: 3 });
  });
});

describe("日時の選択", () => {
  it("出席で日時が 0 件なら保存できない", () => {
    const row = participant({ id: "a", scheduleIds: [], scheduleId: null });
    renderTable([row]);

    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    const first = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(first?.checked).toBe(true);

    fireEvent.click(first!);
    expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(first!);
    expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(false);
  });
});
