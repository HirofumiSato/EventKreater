import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARTICIPANT_COLUMNS,
  LOCKED_PARTICIPANT_COLUMNS,
  PARTICIPANT_COLUMNS_STORAGE_KEY,
  PARTICIPANT_COLUMN_LABELS,
  PARTICIPANT_COLUMN_ORDER,
  parseParticipantColumns,
  toggleParticipantColumn,
  type ParticipantColumnKey,
} from "@/modules/attendance/lib/participant-columns";

describe("参加者名簿の表示列", () => {
  it("既定は名前・出欠・人数・料金プランの 4 列", () => {
    expect([...DEFAULT_PARTICIPANT_COLUMNS]).toEqual(["name", "status", "partySize", "pricePlan"]);
  });

  it("既定の列はすべて表示順の並びに含まれる", () => {
    for (const key of DEFAULT_PARTICIPANT_COLUMNS) {
      expect(PARTICIPANT_COLUMN_ORDER).toContain(key);
    }
  });

  it("保存する鍵は画面ごとに 1 つに固定する", () => {
    expect(PARTICIPANT_COLUMNS_STORAGE_KEY).toBe("eventkreater:participants:columns:v2");
  });

  it("外せない列は名前だけ", () => {
    expect([...LOCKED_PARTICIPANT_COLUMNS]).toEqual(["name"]);
  });

  it("操作の列は持たない（行を押して開く 1 枚が操作を持つ）", () => {
    expect(PARTICIPANT_COLUMN_ORDER).not.toContain("actions");
    expect(Object.keys(PARTICIPANT_COLUMN_LABELS)).toEqual([...PARTICIPANT_COLUMN_ORDER]);
  });

  it("すべての列に日本語のラベルがある", () => {
    for (const key of PARTICIPANT_COLUMN_ORDER) {
      expect(PARTICIPANT_COLUMN_LABELS[key]).not.toBe("");
    }
  });

  it("保存された既知の列は、保存した順ではなく表示順に整える", () => {
    const raw = JSON.stringify(["comment", "name"]);
    expect(parseParticipantColumns(raw)).toEqual(["name", "comment"]);
  });

  it("未知のキーは捨てる", () => {
    const raw = JSON.stringify(["name", "unknown", "status", 42, null]);
    expect(parseParticipantColumns(raw)).toEqual(["name", "status"]);
  });

  it("古い保存値にある操作の列は捨てる", () => {
    const raw = JSON.stringify(["name", "status", "actions"]);
    expect(parseParticipantColumns(raw)).toEqual(["name", "status"]);
  });

  it("名前は保存値に無くても足す", () => {
    const raw = JSON.stringify(["comment"]);
    expect(parseParticipantColumns(raw)).toEqual(["name", "comment"]);
  });

  it("から文字なら既定へ戻す", () => {
    expect(parseParticipantColumns("")).toEqual([...DEFAULT_PARTICIPANT_COLUMNS]);
  });

  it("保存が無ければ既定へ戻す", () => {
    expect(parseParticipantColumns(null)).toEqual([...DEFAULT_PARTICIPANT_COLUMNS]);
  });

  it("壊れた JSON は既定へ戻す", () => {
    expect(parseParticipantColumns("{name:")).toEqual([...DEFAULT_PARTICIPANT_COLUMNS]);
  });

  it("配列でない JSON は既定へ戻す", () => {
    expect(parseParticipantColumns(JSON.stringify({ columns: ["name"] }))).toEqual([
      ...DEFAULT_PARTICIPANT_COLUMNS,
    ]);
  });

  it("空の配列は既定へ戻す", () => {
    expect(parseParticipantColumns("[]")).toEqual([...DEFAULT_PARTICIPANT_COLUMNS]);
  });

  it("既知のキーが 1 つも無ければ既定へ戻す", () => {
    expect(parseParticipantColumns(JSON.stringify(["unknown"]))).toEqual([
      ...DEFAULT_PARTICIPANT_COLUMNS,
    ]);
  });

  it("名前は外せない", () => {
    const current: ParticipantColumnKey[] = ["name", "status"];
    expect(toggleParticipantColumn(current, "name")).toEqual(current);
  });

  it("外せる列を足すと、表示順の位置に入る", () => {
    const current: ParticipantColumnKey[] = ["name", "status"];
    expect(toggleParticipantColumn(current, "comment")).toEqual(["name", "status", "comment"]);
  });

  it("外せる列をもう一度押すと消える", () => {
    const current: ParticipantColumnKey[] = ["name", "status", "comment"];
    expect(toggleParticipantColumn(current, "comment")).toEqual(["name", "status"]);
  });

  it("足した列は保存して読み直しても同じ並びになる", () => {
    const next = toggleParticipantColumn(["name"], "createdAt");
    expect(parseParticipantColumns(JSON.stringify(next))).toEqual(["name", "createdAt"]);
  });

  it("集金の列は料金プランの直後・コメントの前にあり、既定には入らず、保存値から読み戻せる", () => {
    const index = PARTICIPANT_COLUMN_ORDER.indexOf("collected");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(PARTICIPANT_COLUMN_ORDER[index - 1]).toBe("pricePlan");
    expect(PARTICIPANT_COLUMN_ORDER[index + 1]).toBe("comment");
    expect(PARTICIPANT_COLUMN_LABELS.collected).toBe("集金");
    // 既定の 4 列（名前・出欠・人数・料金プラン）は増やさない。
    expect(DEFAULT_PARTICIPANT_COLUMNS).not.toContain("collected");
    // 表示列から選んだ保存値は、そのまま読み戻せる。
    expect(parseParticipantColumns(JSON.stringify(["name", "collected"]))).toEqual([
      "name",
      "collected",
    ]);
  });
});
