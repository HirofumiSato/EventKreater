import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  clampPage,
  DEFAULT_ORGANIZER_FILTER,
  DEFAULT_ORGANIZER_SORT,
  filterOrganizerEvents,
  hasActiveFilter,
  ORGANIZER_PAGE_SIZE,
  pageCountOf,
  pageRangeLabel,
  paginate,
  sortOrganizerEvents,
  todayInTokyo,
} from "@/modules/events/lib/event-filters";

const rows = [
  { status: "PUBLISHED", sortDate: "2026-10-01", title: "先月の会" },
  { status: "PUBLISHED", sortDate: "2026-11-08", title: "次の会" },
  { status: "CLOSED", sortDate: "2026-09-01", title: "止めた会" },
  { status: "PUBLISHED", sortDate: "2026-12-24", title: "年末の会" },
] as const;

/** 既定は全件（過去も含む）で、催しの並びは API のまま。 */
describe("主催一覧の絞り込み", () => {
  it("既定では状態も日付も絞らない", () => {
    expect(hasActiveFilter(DEFAULT_ORGANIZER_FILTER)).toBe(false);
    expect(filterOrganizerEvents(rows, DEFAULT_ORGANIZER_FILTER, "2026-10-28")).toHaveLength(4);
  });

  it("公開中だけ、受付停止だけを選べる", () => {
    const published = filterOrganizerEvents(rows, { ...DEFAULT_ORGANIZER_FILTER, status: "PUBLISHED" }, "2026-10-28");
    expect(published.map((row) => row.title)).toEqual(["先月の会", "次の会", "年末の会"]);

    const closed = filterOrganizerEvents(rows, { ...DEFAULT_ORGANIZER_FILTER, status: "CLOSED" }, "2026-10-28");
    expect(closed.map((row) => row.title)).toEqual(["止めた会"]);
  });

  it("過去を除くと、今日より前の開催日を落とす。今日の催しは残す", () => {
    const input = [
      { status: "PUBLISHED", sortDate: "2026-10-27", title: "昨日" },
      { status: "PUBLISHED", sortDate: "2026-10-28", title: "今日" },
      { status: "PUBLISHED", sortDate: "2026-10-29", title: "明日" },
    ] as const;
    const kept = filterOrganizerEvents(input, { ...DEFAULT_ORGANIZER_FILTER, excludePast: true }, "2026-10-28");
    expect(kept.map((row) => row.title)).toEqual(["今日", "明日"]);
  });

  it("開催日の範囲で絞れる。片側だけの指定もできる", () => {
    const fromOnly = filterOrganizerEvents(rows, { ...DEFAULT_ORGANIZER_FILTER, from: "2026-11-01" }, "2026-10-28");
    expect(fromOnly.map((row) => row.title)).toEqual(["次の会", "年末の会"]);

    const toOnly = filterOrganizerEvents(rows, { ...DEFAULT_ORGANIZER_FILTER, to: "2026-10-31" }, "2026-10-28");
    expect(toOnly.map((row) => row.title)).toEqual(["先月の会", "止めた会"]);

    const range = filterOrganizerEvents(
      rows,
      { ...DEFAULT_ORGANIZER_FILTER, from: "2026-09-01", to: "2026-11-30" },
      "2026-10-28",
    );
    expect(range.map((row) => row.title)).toEqual(["先月の会", "次の会", "止めた会"]);
  });

  it("条件が 1 つでも効いたら、空状態に戻す導線を出す", () => {
    expect(hasActiveFilter({ ...DEFAULT_ORGANIZER_FILTER, status: "PUBLISHED" })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_ORGANIZER_FILTER, excludePast: true })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_ORGANIZER_FILTER, from: "2026-01-01" })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_ORGANIZER_FILTER, to: "2026-12-31" })).toBe(true);
  });

  /** モーダルに畳むボタンは、外に出している過去の除外を数えない。 */
  it("「絞り込む」の件数はモーダルの中の条件だけ数える", () => {
    expect(activeFilterCount(DEFAULT_ORGANIZER_FILTER)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_ORGANIZER_FILTER, excludePast: true })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_ORGANIZER_FILTER, status: "CLOSED" })).toBe(1);
    expect(
      activeFilterCount({ ...DEFAULT_ORGANIZER_FILTER, status: "PUBLISHED", from: "2026-10-01", to: "2026-12-31" }),
    ).toBe(3);
  });
});

/** 開催日の昇順降順。既定は新しい順で、同じ日付は元の並びを保つ。 */
describe("主催一覧の並べ替え", () => {
  it("既定は開催日の新しい順", () => {
    expect(DEFAULT_ORGANIZER_SORT).toBe("desc");
    expect(sortOrganizerEvents(rows, DEFAULT_ORGANIZER_SORT).map((row) => row.title)).toEqual([
      "年末の会",
      "次の会",
      "先月の会",
      "止めた会",
    ]);
  });

  it("古い順に切り替えられる", () => {
    expect(sortOrganizerEvents(rows, "asc").map((row) => row.title)).toEqual([
      "止めた会",
      "先月の会",
      "次の会",
      "年末の会",
    ]);
  });

  it("同じ開催日の催しは、渡された並びのままにする", () => {
    const sameDay = [
      { sortDate: "2026-11-08", title: "先に作った会" },
      { sortDate: "2026-11-01", title: "別の日" },
      { sortDate: "2026-11-08", title: "後に作った会" },
    ] as const;
    expect(sortOrganizerEvents(sameDay, "desc").map((row) => row.title)).toEqual([
      "先に作った会",
      "後に作った会",
      "別の日",
    ]);
    expect(sortOrganizerEvents(sameDay, "asc").map((row) => row.title)).toEqual([
      "別の日",
      "先に作った会",
      "後に作った会",
    ]);
  });

  it("元の配列は書き換えない", () => {
    const input = [...rows];
    sortOrganizerEvents(input, "asc");
    expect(input.map((row) => row.title)).toEqual(["先月の会", "次の会", "止めた会", "年末の会"]);
  });
});

/** 溜まった催しを 10 件ずつ区切る。0 件でも「1 / 1」を出す。 */
describe("主催一覧のページ割り", () => {
  const many = Array.from({ length: 23 }, (_, index) => ({
    status: "PUBLISHED" as const,
    sortDate: `2026-01-${String(index + 1).padStart(2, "0")}`,
    title: `${index + 1}件目`,
  }));

  it("10 件ずつ区切り、最後のページは余りだけを返す", () => {
    expect(pageCountOf(23)).toBe(3);
    expect(paginate(many, 1)).toHaveLength(ORGANIZER_PAGE_SIZE);
    expect(paginate(many, 3).map((row) => row.title)).toEqual(["21件目", "22件目", "23件目"]);
  });

  it("ページ番号が範囲外なら端に寄せる", () => {
    expect(clampPage(0, 23)).toBe(1);
    expect(clampPage(9, 23)).toBe(3);
    expect(paginate(many, 9).at(-1)?.title).toBe("23件目");
  });

  it("件数が減っても空のページを出さない", () => {
    expect(pageCountOf(0)).toBe(1);
    expect(clampPage(3, 4)).toBe(1);
  });

  it("ページャーの説明に件数の範囲を出す", () => {
    expect(pageRangeLabel(23, 1)).toBe("23件中 1〜10件");
    expect(pageRangeLabel(23, 3)).toBe("23件中 21〜23件");
    expect(pageRangeLabel(0, 1)).toBe("0件");
  });
});

describe("日本時間の今日", () => {
  it("UTC の 15 時を過ぎたら翌日として扱う", () => {
    expect(todayInTokyo(new Date("2026-10-27T14:59:00.000Z"))).toBe("2026-10-27");
    expect(todayInTokyo(new Date("2026-10-27T15:00:00.000Z"))).toBe("2026-10-28");
  });
});
