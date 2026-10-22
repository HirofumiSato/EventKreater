import { describe, expect, it } from "vitest";
import {
  CAPACITY_PRESETS,
  CAPACITY_PRESET_MAX,
  capacityForSelection,
  capacityFromCustomInput,
  capacitySelectionOf,
} from "@/modules/events/lib/capacity";

describe("定員の選択", () => {
  it("1〜50 を 1 刻みで並べる", () => {
    expect(CAPACITY_PRESETS).toHaveLength(CAPACITY_PRESET_MAX);
    expect(CAPACITY_PRESETS[0]).toBe(1);
    expect(CAPACITY_PRESETS.at(-1)).toBe(50);
  });

  it("未設定は無制限として扱う", () => {
    expect(capacitySelectionOf(null)).toBe("");
  });

  it("50 以下はその人数の選択肢を選んだ状態にする", () => {
    expect(capacitySelectionOf(1)).toBe("1");
    expect(capacitySelectionOf(30)).toBe("30");
    expect(capacitySelectionOf(50)).toBe("50");
  });

  it("51 以上は数値入力の側に寄せる", () => {
    expect(capacitySelectionOf(51)).toBe("custom");
    expect(capacitySelectionOf(120)).toBe("custom");
  });

  it("無制限を選ぶと null に戻す", () => {
    expect(capacityForSelection("", 30)).toBeNull();
  });

  it("人数を選ぶとその人数になる", () => {
    expect(capacityForSelection("25", null)).toBe(25);
  });

  it("51以上を選んだら、すでに51以上が入っていればその人数を保つ", () => {
    expect(capacityForSelection("custom", 120)).toBe(120);
    expect(capacityForSelection("custom", 30)).toBe(51);
    expect(capacityForSelection("custom", null)).toBe(51);
  });

  it("数値入力は正の整数だけを受け付ける", () => {
    expect(capacityFromCustomInput("120")).toBe(120);
    expect(capacityFromCustomInput(" 51 ")).toBe(51);
    expect(capacityFromCustomInput("")).toBeNull();
    expect(capacityFromCustomInput("0")).toBeNull();
    expect(capacityFromCustomInput("-5")).toBeNull();
    expect(capacityFromCustomInput("1.5")).toBeNull();
    expect(capacityFromCustomInput("abc")).toBeNull();
  });
});
