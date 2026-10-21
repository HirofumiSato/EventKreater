/** 全角数字を半角にし、数字以外を落として 7 桁の郵便番号にする。 */
export function normalizePostalCode(value: string): string {
  return value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, "");
}

/** 表示用に 3 桁 + 4 桁へ区切る。7 桁でなければ入力値をそのまま返す。 */
export function formatPostalCode(value: string): string {
  const normalized = normalizePostalCode(value);
  if (normalized.length !== 7) return value;
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
}
