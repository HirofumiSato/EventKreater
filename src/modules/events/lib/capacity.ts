/**
 * 定員の入力。数値の直接入力ではなく、決まった人数から選ばせる。
 * 51 人以上だけは件数が読めないため「51以上（数値入力）」で受ける。
 */

/** プルダウンに並べる上限。1〜50 を 1 刻みで出す。 */
export const CAPACITY_PRESET_MAX = 50;

export const CAPACITY_PRESETS: readonly number[] = Array.from(
  { length: CAPACITY_PRESET_MAX },
  (_, index) => index + 1,
);

/** 「無制限」「1〜50 のいずれか」「51以上（数値入力）」。 */
export type CapacitySelection = "" | "custom" | `${number}`;

/** 保存値から選択欄の値を決める。51 以上は数値入力の側に寄せる。 */
export function capacitySelectionOf(capacity: number | null): CapacitySelection {
  if (capacity === null || !Number.isInteger(capacity) || capacity < 1) return "";
  if (capacity > CAPACITY_PRESET_MAX) return "custom";
  return String(capacity) as CapacitySelection;
}

/**
 * 選択欄を切り替えたときの保存値。
 * 「51以上」を選んだ直後は、まだ人数が決まっていないので仮に 51 を入れる。
 * すでに 51 以上が入っていれば、その人数を保つ。
 */
export function capacityForSelection(
  selection: CapacitySelection,
  current: number | null,
): number | null {
  if (selection === "") return null;
  if (selection === "custom") {
    return current !== null && current > CAPACITY_PRESET_MAX ? current : CAPACITY_PRESET_MAX + 1;
  }
  const parsed = Number(selection);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= CAPACITY_PRESET_MAX ? parsed : current;
}

/** 「51以上」の数値入力を保存値にする。空・0 以下・小数は未入力として null。 */
export function capacityFromCustomInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}
