/**
 * 主催一覧の絞り込み・並べ替え・ページ割り。
 *
 * 一覧 API（`GET /api/v1/organizer/events`）は全件を返す。マイページとカレンダーが
 * 全件前提で作られているため、絞り込みとページ割りは画面側で持つ。
 * 催しは年を跨いで溜まり続けるので、状態・過去・開催日で絞り、開催日の昇順降順で
 * 並べ替え、1 ページ 10 件ずつ出す。
 *
 * 判定は文字列（`sortDate` は `YYYY-MM-DD`）の比較だけで済ませる。
 * 日付を `Date` に戻すと、時差で 1 日ずれる余地が生まれる。
 */
import type { EventStatus } from "@/modules/events/types";

/** 「すべて」「公開中のみ」「受付停止のみ」。 */
export type OrganizerStatusFilter = "ALL" | "PUBLISHED" | "CLOSED";

/** 開催日の並び順。`asc` は古い順、`desc` は新しい順。 */
export type OrganizerSortOrder = "asc" | "desc";

/** 1 ページに並べるカードの枚数。 */
export const ORGANIZER_PAGE_SIZE = 10;

export interface OrganizerListFilter {
  status: OrganizerStatusFilter;
  /** 開催日が今日より前の催しを落とす。 */
  excludePast: boolean;
  /** 開催日の下限（`YYYY-MM-DD`）。空なら絞らない。 */
  from: string;
  /** 開催日の上限（`YYYY-MM-DD`）。空なら絞らない。 */
  to: string;
}

/** 開いた直後の状態。過去も含めた全件を、今までどおり新しい順で出す。 */
export const DEFAULT_ORGANIZER_FILTER: OrganizerListFilter = {
  status: "ALL",
  excludePast: false,
  from: "",
  to: "",
};

/**
 * 開いた直後の並び順。新しい開催日から出す。
 *
 * 既定の絞り込みは過去も含むため、古い順にすると何年も前の催しが先頭に来る。
 * API が返す「作った新しい順」とも向きが揃う。
 */
export const DEFAULT_ORGANIZER_SORT: OrganizerSortOrder = "desc";

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の今日（`YYYY-MM-DD`）。`sortDate` と同じ形式で比べるために使う。 */
export function todayInTokyo(now = new Date()): string {
  const shifted = new Date(now.getTime() + TOKYO_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 絞り込みが 1 つでも効いているか。空状態に「条件を戻す」を出すかの判定。 */
export function hasActiveFilter(filter: OrganizerListFilter): boolean {
  return filter.status !== "ALL" || filter.excludePast || filter.from !== "" || filter.to !== "";
}

/**
 * モーダルに畳んだ条件の数。「絞り込む（2）」と出すために使う。
 *
 * 過去の除外（`excludePast`）はモーダルの外に常に出しているので数えない。
 * 数えると、モーダルを開いても消せない条件が件数に残り、数が合わなくなる。
 */
export function activeFilterCount(filter: OrganizerListFilter): number {
  let count = 0;
  if (filter.status !== "ALL") count += 1;
  if (filter.from !== "") count += 1;
  if (filter.to !== "") count += 1;
  return count;
}

/**
 * 状態・過去・開催日の範囲で絞る。並び順は API のまま（作った新しい順）で変えない。
 * 開催日で並べ替えるのは `sortOrganizerEvents` の役目で、絞り込みとは分けて呼ぶ。
 * 今日の催しは「過去」にしない（当日はまだ開催前なので落とさない）。
 */
export function filterOrganizerEvents<T extends { status: EventStatus; sortDate: string }>(
  rows: readonly T[],
  filter: OrganizerListFilter,
  today: string,
): T[] {
  return rows.filter((row) => {
    if (filter.status !== "ALL" && row.status !== filter.status) return false;
    if (filter.excludePast && row.sortDate < today) return false;
    if (filter.from !== "" && row.sortDate < filter.from) return false;
    if (filter.to !== "" && row.sortDate > filter.to) return false;
    return true;
  });
}

/**
 * 開催日（`sortDate`）で並べ替える。新しい順（`desc`）と古い順（`asc`）を切り替える。
 *
 * 同じ開催日の催しは、渡された並び（API の作った新しい順）のままにする。
 * `Array.prototype.sort` は安定なので、比較で 0 を返せば元の順が残る。
 * 日付は `YYYY-MM-DD` の文字列のまま比べる（`Date` に戻すと時差で 1 日ずれる余地が生まれる）。
 */
export function sortOrganizerEvents<T extends { sortDate: string }>(
  rows: readonly T[],
  order: OrganizerSortOrder,
): T[] {
  const direction = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.sortDate === b.sortDate) return 0;
    return a.sortDate < b.sortDate ? -direction : direction;
  });
}

/** 全何ページか。0 件でも 1 ページとして扱う（「1 / 1」を出すため）。 */
export function pageCountOf(total: number, pageSize = ORGANIZER_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 絞り込みで件数が減ったときに、行き場の無いページ番号を畳む。 */
export function clampPage(page: number, total: number, pageSize = ORGANIZER_PAGE_SIZE): number {
  const safe = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(Math.max(1, safe), pageCountOf(total, pageSize));
}

/** 1 ページ分だけ切り出す。ページ番号が範囲外なら、最後のページに寄せる。 */
export function paginate<T>(rows: readonly T[], page: number, pageSize = ORGANIZER_PAGE_SIZE): T[] {
  const current = clampPage(page, rows.length, pageSize);
  const start = (current - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** ページャーの説明。「12件中 1〜10件」。 */
export function pageRangeLabel(total: number, page: number, pageSize = ORGANIZER_PAGE_SIZE): string {
  if (total === 0) return "0件";
  const current = clampPage(page, total, pageSize);
  const start = (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  return `${total}件中 ${start}〜${end}件`;
}
