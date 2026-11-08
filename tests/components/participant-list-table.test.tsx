// @vitest-environment jsdom
//
// 名簿（`ParticipantListTable`）の人数まわりの再発防止。
//
//   1. 人数は出席のときだけ出す。欠席・参加要望は席を取らないので「—」
//   2. 支払額は 1 人ぶんと人数ぶんの合計を並べる（集金は 1 人ずつ記録する）
//   3. 参加要望の承認は人数の入力から始まる（要望のままでは人数を出さない）
//   4. 出席なのに日時が 0 件なら保存させない
//   5. 集金の列は既定では出さず、表示列から選んだときと CSV にだけ出す
//   6. 「参加者を追加」は行の無い 1 枚を開き、保存は `id: null`（POST）で送る
//   7. 削除済みは最下部に残して「名簿に戻す」だけを出し、絞り込み・CSV からは外す
//   8. 名前とコメントの上限は API と同じ値。定員の案内は編集中の行の人数を引いて数える
//
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantListTable } from "@/modules/attendance/components/ParticipantListTable";
import { RSVP_COMMENT_MAX, RSVP_NAME_MAX } from "@/modules/attendance/lib/rsvp-form";
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
    collectedAt: null,
    deletedAt: null,
    ...rest,
  };
}

const SCHEDULES = [schedule("s1", "2026-11-21"), schedule("s2", "2026-11-22")];
const PLANS = [plan("p1", 3000)];

function renderTable(
  rows: ParticipantRow[],
  onSave = vi.fn<(input: unknown) => Promise<void>>(async () => {}),
  extra: {
    capacity?: number | null;
    /** 定員の案内は行の人数で数えるので、人数を明示したいときに使う。 */
    attendingCount?: number;
    onRestore?: (id: string) => Promise<void>;
  } = {},
) {
  return {
    onSave,
    ...render(
      <ParticipantListTable
        eventId="ev-1"
        rows={rows}
        schedules={SCHEDULES}
        pricePlans={PLANS}
        attendingCount={
          extra.attendingCount ?? rows.filter((row) => row.status === "ATTENDING").length
        }
        declinedCount={rows.filter((row) => row.status === "DECLINED").length}
        waitlistedCount={rows.filter((row) => row.status === "WAITLISTED").length}
        capacity={extra.capacity ?? null}
        onSave={onSave}
        onRestore={extra.onRestore}
      />,
    ),
  };
}

afterEach(() => {
  cleanup();
  // 表示列の選択は端末に残るので、次のテストへ持ち越さない。
  window.localStorage.clear();
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
  it("行を開いて出席に上げると、人数を入れて保存できる", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "要望さん の出欠を変更" }));

    // 要望のままでは人数の欄は出ない。
    expect(screen.queryByLabelText("人数")).toBeNull();

    fireEvent.change(screen.getByLabelText("出欠"), { target: { value: "ATTENDING" } });
    const input = screen.getByLabelText("人数") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ id: "w", status: "ATTENDING", partySize: 3 });
  });
});

describe("日時の選択", () => {
  it("出席で日時が 0 件なら保存できない", () => {
    const row = participant({ id: "a", scheduleIds: [], scheduleId: null });
    renderTable([row]);

    fireEvent.click(screen.getByRole("button", { name: "佐藤 みのり の出欠を変更" }));
    const first = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(first?.checked).toBe(true);

    fireEvent.click(first!);
    expect(screen.getByRole("button", { name: "保存する" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(first!);
    expect(screen.getByRole("button", { name: "保存する" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("操作の置き場所", () => {
  it("表に操作の列を置かず、行を押して 1 枚を開く", () => {
    renderTable([participant({ id: "a" })]);

    expect(screen.queryByRole("columnheader", { name: "操作" })).toBeNull();
    expect(screen.queryByRole("button", { name: "変更" })).toBeNull();
    expect(screen.getByRole("button", { name: "佐藤 みのり の出欠を変更" })).toBeTruthy();
  });
});

/** jsdom の Blob を、CSV の検証のために文字列へ戻す。 */
function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("集金の列", () => {
  const collected = new Date("2026-11-01T03:00:00.000Z").toISOString();

  it("既定では出ず、表示列から集金を選ぶと出る", () => {
    const { container } = renderTable([
      participant({ id: "a", collectedAt: collected }),
      participant({ id: "b", name: "未集金さん", collectedAt: null }),
    ]);

    // 既定の 4 列（名前・出欠・人数・料金プラン）には集金を入れない。
    expect(screen.queryByRole("columnheader", { name: "集金" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "表示列" }));
    fireEvent.click(screen.getByLabelText("集金"));

    expect(screen.getByRole("columnheader", { name: "集金" })).toBeTruthy();
    const cells = Array.from(
      container.querySelectorAll<HTMLTableCellElement>('tbody td[data-column="collected"]'),
    ).map((cell) => cell.textContent);
    // 出席かつ集金日時がある行だけ「済」。未集金は「—」。
    expect(cells).toEqual(["済", "—"]);
  });

  it("CSV に集金の列が入り、集金済みの行だけ「済」になる", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:participants.csv");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    try {
      renderTable([
        participant({ id: "a", collectedAt: collected }),
        participant({ id: "b", name: "未集金さん", collectedAt: null }),
      ]);

      fireEvent.click(screen.getByRole("button", { name: "CSVで書き出す" }));

      const blob = createObjectURL.mock.calls[0]![0];
      const lines = (await readBlobAsText(blob)).replace(/^\uFEFF/, "").split("\n");
      const header = lines[0]!.split(",");
      const column = header.indexOf("集金");
      expect(column).toBeGreaterThanOrEqual(0);
      expect(lines[1]!.split(",")[column]).toBe("済");
      expect(lines[2]!.split(",")[column]).toBe("");
    } finally {
      click.mockRestore();
      Object.assign(URL, { createObjectURL: originalCreate, revokeObjectURL: originalRevoke });
    }
  });
});

describe("参加者の追加", () => {
  it("「参加者を追加」を押すと、名簿に載せる人の 1 枚が開く", () => {
    renderTable([participant({ id: "a" })]);

    fireEvent.click(screen.getByRole("button", { name: "参加者を追加" }));

    expect(screen.getByRole("heading", { name: "参加者を追加" })).toBeTruthy();
    expect(screen.getByText("名簿に載せたい人を追加します。")).toBeTruthy();
    // 追加ではまだ名簿に無いので、集金も削除も出さない。
    expect(screen.queryByRole("button", { name: "集金済みにする" })).toBeNull();
    expect(screen.queryByRole("button", { name: "名簿から削除" })).toBeNull();
  });

  it("名前と人数を入れて保存すると、行の無い `id: null` で送る", async () => {
    const { onSave } = renderTable([participant({ id: "a" })]);

    fireEvent.click(screen.getByRole("button", { name: "参加者を追加" }));
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "田中 太郎" } });
    // 出席のまま。人数だけ 2 人へ変える。
    fireEvent.change(screen.getByLabelText("人数"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      id: null,
      name: "田中 太郎",
      status: "ATTENDING",
      partySize: 2,
    });
  });

  it("名前が空なら保存できず、押しても送らない", () => {
    const { onSave } = renderTable([participant({ id: "a" })]);

    fireEvent.click(screen.getByRole("button", { name: "参加者を追加" }));
    const save = screen.getByRole("button", { name: "保存する" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("入力の上限", () => {
  it("名前とコメントの maxLength は API の上限と同じ値を使う", () => {
    renderTable([participant({ id: "a" })]);

    fireEvent.click(screen.getByRole("button", { name: "参加者を追加" }));

    // 画面だけ 100 文字まで通すと、51〜100 文字の名前がサーバーで 400 になる。
    expect((screen.getByLabelText("名前") as HTMLInputElement).maxLength).toBe(RSVP_NAME_MAX);
    expect((screen.getByLabelText("コメント") as HTMLInputElement).maxLength).toBe(
      RSVP_COMMENT_MAX,
    );
  });
});

describe("定員の案内", () => {
  const HINT = "定員に達しています。参加要望で追加できます。";

  it("編集で席がちょうど収まる行には案内を出さない", () => {
    // 3 人で定員 3。編集対象の 3 人は attendingCount に既に含まれている。
    renderTable([participant({ id: "a", partySize: 3 })], undefined, {
      capacity: 3,
      attendingCount: 3,
    });

    fireEvent.click(screen.getByRole("button", { name: "佐藤 みのり の出欠を変更" }));

    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("人数を増やして定員を超えると案内を出す", () => {
    renderTable([participant({ id: "a", partySize: 2 })], undefined, {
      capacity: 2,
      attendingCount: 2,
    });

    fireEvent.click(screen.getByRole("button", { name: "佐藤 みのり の出欠を変更" }));
    fireEvent.change(screen.getByLabelText("人数"), { target: { value: "3" } });

    expect(screen.getByText(HINT)).toBeTruthy();
  });
});

describe("削除済みの行", () => {
  const deleted = participant({
    id: "d1",
    name: "削除さん",
    partySize: 3,
    deletedAt: new Date("2026-11-05T03:00:00.000Z").toISOString(),
  });

  it("入力の配列で先頭でも最下部に並び、出欠の札の代わりに「削除済み」を出す", () => {
    const { container } = renderTable([deleted, participant({ id: "a" })]);

    const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector(".roster__name")?.textContent).toBe("佐藤 みのり");
    expect(rows[1]!.querySelector(".roster__name")?.textContent).toBe("削除さん");

    const deletedRow = rows[1]!;
    expect(deletedRow.classList.contains("roster__row--deleted")).toBe(true);
    expect(deletedRow.querySelector('[data-column="status"]')?.textContent).toBe("削除済み");
    // 削除済みは席を取らないので、出席のままでも人数は「—」にする。
    expect(deletedRow.querySelectorAll("td")[3]!.textContent).toBe("—");
  });

  it("押すと「名簿に戻す」だけの 1 枚が開き、押すと onRestore に id を渡す", async () => {
    const onRestore = vi.fn<(id: string) => Promise<void>>(async () => {});
    renderTable([deleted], undefined, { onRestore });

    fireEvent.click(screen.getByRole("button", { name: "削除さん の削除を取り消す" }));

    expect(screen.getByRole("heading", { name: "削除さん" })).toBeTruthy();
    expect(screen.getByText("削除さん を名簿から削除しました。")).toBeTruthy();
    // 入力欄は出さない。直すなら先に名簿へ戻す。
    expect(screen.queryByLabelText("名前")).toBeNull();
    expect(screen.queryByLabelText("出欠")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存する" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "名簿に戻す" }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith("d1"));
  });
});

describe("削除済みの絞り込み", () => {
  it("削除済みが 1 件も無ければ札を出さない", () => {
    renderTable([participant({ id: "a" })]);

    expect(screen.queryByLabelText(/^削除済み/)).toBeNull();
  });

  it("削除済みがあると札が出て、選ぶと削除済みだけになる", () => {
    const { container } = renderTable([
      participant({ id: "a" }),
      participant({
        id: "d1",
        name: "削除さん",
        deletedAt: new Date("2026-11-05T03:00:00.000Z").toISOString(),
      }),
    ]);

    fireEvent.click(screen.getByLabelText("削除済み 1"));

    const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector(".roster__name")?.textContent).toBe("削除さん");
    expect(screen.queryByRole("button", { name: "佐藤 みのり の出欠を変更" })).toBeNull();
  });
});

describe("CSV の削除済み", () => {
  it("CSV は削除済みを出さない", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:participants.csv");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    try {
      renderTable([
        participant({ id: "a", name: "残るさん" }),
        participant({
          id: "d1",
          name: "消えたさん",
          deletedAt: new Date("2026-11-05T03:00:00.000Z").toISOString(),
        }),
      ]);

      fireEvent.click(screen.getByRole("button", { name: "CSVで書き出す" }));

      const text = await readBlobAsText(createObjectURL.mock.calls[0]![0]);
      expect(text).toContain("残るさん");
      expect(text).not.toContain("消えたさん");
    } finally {
      click.mockRestore();
      Object.assign(URL, { createObjectURL: originalCreate, revokeObjectURL: originalRevoke });
    }
  });
});
