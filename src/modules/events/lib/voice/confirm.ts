import type { VoiceField, VoiceFieldKey, VoicePatch } from "@/modules/events/lib/voice/types";

/**
 * 確認ダイアログを省いてよいかの判定。
 *
 * 値が読めた（`patch` が null でない）だけでは足りない。欄の定義が
 * `confirm: "auto"` のときだけ即座に入れる。未指定は `"always"` として扱い、
 * 自由文の欄が黙って入ることを防ぐ。
 */
export function shouldAutoConfirm(
  field: VoiceField,
  patch: VoicePatch | null,
): boolean {
  if (patch === null) return false;
  return (field.confirm ?? "always") === "auto";
}

/**
 * 確認ダイアログで複数行の入力にする欄。
 *
 * 会場名・補足・住所の一部は、話した内容をそのまま確かめたい長さになる。
 * 1 行の input に押し込むと、読み上げでは全体が見えず、直すときも横に送る必要がある。
 * それ以外（日付・時刻・金額・人数・郵便番号・催し名など）は短いので input にする。
 */
export const LONG_VOICE_FIELDS: ReadonlySet<VoiceFieldKey> = new Set<VoiceFieldKey>([
  "venueName",
  "planNote",
  "city",
  "town",
  "addressLine",
  "building",
]);

/** 確認ダイアログの入力を textarea にするか。 */
export function isLongVoiceField(key: VoiceFieldKey): boolean {
  return LONG_VOICE_FIELDS.has(key);
}
