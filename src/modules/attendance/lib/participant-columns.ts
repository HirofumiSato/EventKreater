/**
 * 参加者名簿に出す列の決まり。
 *
 * スマホでは表が横に長いと読めないので、主要な列だけを既定にし、残りは「表示列」から選ぶ。
 * 選んだ列はこの端末の `localStorage` に覚える（画面を開き直しても元に戻らない）。
 * 並びは常に `PARTICIPANT_COLUMN_ORDER` の順にそろえ、選んだ順にはしない。
 *
 * 行の操作（変更・承認・削除）は列に持たない。行を押して開く 1 枚（`ParticipantSheet`）が持ち、
 * 表は読むためだけに使う。
 */

/** 名簿の列。`th` / `td` の `data-column` と同じ値を使う。 */
export type ParticipantColumnKey =
  | "name"
  | "gender"
  | "status"
  | "partySize"
  | "schedule"
  | "pricePlan"
  | "collected"
  | "comment"
  | "createdAt";

/**
 * 表に並べる順。表示列を選んでもこの順から動かさない。
 *
 * 集金を一番左に置く。当日の受付では、来た人を見ながら「誰が払ったか」を先に確かめるので、
 * 名前より先に指が届く位置に置く。名前の隣にあるので、どの行の集金かは見失わない。
 */
export const PARTICIPANT_COLUMN_ORDER: readonly ParticipantColumnKey[] = [
  "collected",
  "name",
  "gender",
  "status",
  "partySize",
  "schedule",
  "pricePlan",
  "comment",
  "createdAt",
];

/** 表示列の選択に出す日本語のラベル。`th` の見出しと同じ言葉を使う。 */
export const PARTICIPANT_COLUMN_LABELS: Record<ParticipantColumnKey, string> = {
  collected: "集金",
  name: "名前",
  gender: "性別",
  status: "出欠",
  partySize: "人数",
  schedule: "日時",
  pricePlan: "料金プラン",
  comment: "コメント",
  createdAt: "回答日時",
};

/**
 * 外せない列。集金が無いと受け取ったかをその場で記録できず、名前が無いと
 * 誰の行か分からなくなる（どちらも名簿を開く理由そのものである）。
 * 表示列の選択では無効にし、保存値からも落とさない。
 */
export const LOCKED_PARTICIPANT_COLUMNS: readonly ParticipantColumnKey[] = ["collected", "name"];

/**
 * 何も選んでいない人の既定。スマホで 1 段に収まる主要列だけにする。
 * 集金は一番左に必ず出す（当日の受付で使う列なので、隠すと意味が無い）。
 */
export const DEFAULT_PARTICIPANT_COLUMNS: readonly ParticipantColumnKey[] = [
  "collected",
  "name",
  "status",
  "partySize",
  "pricePlan",
];

/**
 * 選んだ列を覚える鍵。形を変えるときは `:v2` のように上げる。
 * 集金を既定の列にしたときに `v2` から上げた（古い保存値のままだと、
 * この端末だけ集金の列が出ない）。
 */
export const PARTICIPANT_COLUMNS_STORAGE_KEY = "eventkreater:participants:columns:v3";

function isParticipantColumnKey(value: unknown): value is ParticipantColumnKey {
  return typeof value === "string" && (PARTICIPANT_COLUMN_ORDER as readonly string[]).includes(value);
}

/**
 * 保存されていた文字列を、表示してよい列の配列へ直す。
 *
 * 壊れた JSON・配列でない値・未知のキーは捨てる。並びは表示順に整え、重複も落とす。
 * 外せない列は、保存値に無くても足す（古い保存値や手で書き換えた値でも名簿が壊れない）。
 * 既知のキーが 1 つも残らない（空配列・未知のキーだけ）なら既定へ戻す。
 */
export function parseParticipantColumns(raw: string | null | undefined): ParticipantColumnKey[] {
  const fallback = [...DEFAULT_PARTICIPANT_COLUMNS];
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) return fallback;

  const chosen = new Set(parsed.filter(isParticipantColumnKey));
  if (chosen.size === 0) return fallback;
  for (const key of LOCKED_PARTICIPANT_COLUMNS) chosen.add(key);

  return PARTICIPANT_COLUMN_ORDER.filter((key) => chosen.has(key));
}

/**
 * 表示列の選択を 1 つ切り替える。
 * 外せない列（名前）は、外そうとしてもそのまま返す。
 */
export function toggleParticipantColumn(
  current: readonly ParticipantColumnKey[],
  key: ParticipantColumnKey,
): ParticipantColumnKey[] {
  if (LOCKED_PARTICIPANT_COLUMNS.includes(key)) return [...current];
  const selected = new Set(current);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return PARTICIPANT_COLUMN_ORDER.filter((k) => selected.has(k));
}
