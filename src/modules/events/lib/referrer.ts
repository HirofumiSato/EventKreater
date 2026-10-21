/**
 * 勧誘カードから渡された参照元として認めてよいイベントか。
 * 存在しない、論理削除済み、下書きのイベントは参照元にしない。
 * 不正な値でも作成は止めず、呼び出し側が NULL として扱う。
 */
export function isEligibleReferrer(
  event: { isDeleted: boolean; status: string } | null | undefined,
): boolean {
  if (!event) return false;
  if (event.isDeleted) return false;
  return event.status === "PUBLISHED" || event.status === "CLOSED";
}
