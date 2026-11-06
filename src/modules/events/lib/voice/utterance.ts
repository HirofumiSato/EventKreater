import { voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import type {
  VoiceField,
  VoiceFieldKey,
  VoiceFieldScope,
  VoicePatch,
  VoiceSlot,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";
import type { EventFormValues } from "@/modules/events/types";

/**
 * 節の区切り。読点・句点・カンマ・終止点に、話し言葉のつなぎ（で・と・や）と
 * 連続する空白を足したもの。
 *
 * 「で」「と」「や」は語の一部にも現れる（「やまだ」など）が、
 * 1 回の発話は短い言い切りの並びなので、区切りとして扱う方が取りこぼしが少ない。
 */
const DELIMITER = /[、。，,．]|で|と|や|\s+/gu;

/**
 * 発話を節に分ける。前後の空白を落とし、空になった節は捨てる。
 *
 * `index` は元の文での節の開始位置。閉じた形の欄が節を消費したかを
 * 位置で判定できるように返す（いまは節の番号で足りるが、将来
 * 「一致した部分だけを消費する」ように広げられるようにしておく）。
 */
export function splitUtterance(text: string): { text: string; index: number }[] {
  const clauses: { text: string; index: number }[] = [];
  let start = 0;

  const collect = (end: number): void => {
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      // 前後の空白を落としても、元の文での開始位置は保つ。
      const leading = raw.length - raw.trimStart().length;
      clauses.push({ text: trimmed, index: start + leading });
    }
  };

  for (const matched of text.matchAll(DELIMITER)) {
    const index = matched.index ?? start;
    collect(index);
    start = index + matched[0].length;
  }
  collect(text.length);

  return clauses;
}

/**
 * 形が閉じている欄。一致した節はその欄だけのものにし、ほかの欄へ使い回さない。
 * 日付・時刻・金額・定員・郵便番号・都道府県・雨天・期限が該当する。
 *
 * ここに無い欄（イベント名・主催者名・会場名・プラン名・補足・市区町村・町域・
 * 番地・建物）は自由文で、`parse` だけでは何にでも一致してしまう。
 */
export const CLOSED_FIELDS: ReadonlySet<VoiceFieldKey> = new Set<VoiceFieldKey>([
  "scheduleDate",
  "scheduleStart",
  "scheduleEnd",
  "planAmount",
  "postalCode",
  "prefecture",
  "rainPolicy",
  "capacity",
  "rsvpDeadline",
]);

/**
 * 区切りで閉じている前半だけを返す。
 *
 * 話している途中の文字列は、最後の節がまだ言い終わっていない（「12月」まで来ていて
 * 「5日」が続く）。言い終わっていない節を `parse` に通すと、途中の値が確定値のように
 * 読めてしまうため、最後の区切りより後ろは捨てる。
 */
export function terminatedPrefix(text: string): string {
  let end = 0;
  for (const matched of text.matchAll(DELIMITER)) {
    end = (matched.index ?? 0) + matched[0].length;
  }
  return end === 0 ? "" : text.slice(0, end);
}

export interface UtteranceAssignment {
  /** 割り当て先のマス。`欄のキー:行` の形。 */
  slotId: VoiceSlotId;
  /** 割り当てた節の文字列。確認画面にそのまま出す。 */
  text: string;
  /** 欄の `parse` が返したパッチ。値はここから作り直さない。 */
  patch: VoicePatch;
}

export interface AssignUtteranceInput {
  /** 1 回の文字起こしの全文。 */
  text: string;
  /** いまのフォームの値。`parse` にそのまま渡す。 */
  value: EventFormValues;
  /** 相対日付の基準。テストで固定するために受け取る。 */
  now: Date;
  /** 巡回の対象。任意欄を聞くか、主催者名を出すかが変わる。 */
  scope: VoiceFieldScope;
  /**
   * 割当の対象にするマス。省略したら巡回順のすべてを使う。
   * まとめて話すときは空欄だけ（`batchTargets`）を渡し、入力済みの欄を上書きしない。
   */
  targets?: readonly VoiceSlot[];
}

/** 自由文の欄が節を受け取るか。欄の語彙（`keywords`）が節に現れるときだけ受け取る。 */
function hasClue(field: VoiceField, text: string): boolean {
  const keywords = field.keywords;
  if (!keywords || keywords.length === 0) return false;
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

/**
 * `scheduleStart` が範囲を返したら、同じ行の `scheduleEnd` はもう埋まっている。
 * 開始のパッチが終了時刻も持っているため、終了を別の割当として返すと
 * パッチの適用順で開始時刻を巻き戻してしまう。
 */
function markRangeEnd(
  slot: VoiceSlot,
  patch: VoicePatch,
  usedSlots: Set<VoiceSlotId>,
): void {
  if (slot.key !== "scheduleStart") return;
  const row = patch.schedules?.[slot.row];
  if (row?.startTime && row.endTime) {
    usedSlots.add(`scheduleEnd:${slot.row}`);
  }
}

/**
 * 1 回の文字起こしを、決まった手順で複数の欄へ割り当てる。
 *
 * 1. 節に分ける
 * 2. 巡回順のマスを取る（`voiceFieldOrder`）
 * 3. 閉じた形の欄を巡回順に当て、一致した節を消費する
 * 4. 自由文の欄を巡回順に当てる。こちらは最後に回し、語彙の手掛かりがある節だけを受ける
 * 5. `scheduleStart` が範囲を返したら `scheduleEnd` は割当済みにする
 * 6. どこにも当たらなかった節を返す（LLM に割当だけを尋ねる材料）
 *
 * 値は必ず `field.parse` の戻り値を使い、ここでは作らない。
 */
export function assignUtterance(input: AssignUtteranceInput): {
  assignments: UtteranceAssignment[];
  unassigned: string[];
} {
  const clauses = splitUtterance(input.text);
  // 対象を渡されたときは、その並びだけを巡回する（空欄だけのまとめて入力）。
  const slots = input.targets ?? voiceFieldOrder(input.value, input.scope);

  const claimed = new Set<number>();
  const usedSlots = new Set<VoiceSlotId>();
  const assignments: UtteranceAssignment[] = [];

  const tryAssign = (slot: VoiceSlot, requireClue: boolean): void => {
    if (usedSlots.has(slot.id)) return;
    const context = { now: input.now, value: input.value, row: slot.row };

    for (let index = 0; index < clauses.length; index += 1) {
      if (claimed.has(index)) continue;
      const clause = clauses[index];
      // 自由文は語彙が合う節だけを受ける。数字だけの節を先に固い欄へ取らせるため、
      // 自由文はこの関数の 2 周目（閉じた形のあと）にだけ呼ぶ。
      if (requireClue && !hasClue(slot.field, clause.text)) continue;

      const patch = slot.field.parse(clause.text, context);
      if (patch === null) continue;

      claimed.add(index);
      usedSlots.add(slot.id);
      assignments.push({ slotId: slot.id, text: clause.text, patch });
      markRangeEnd(slot, patch, usedSlots);
      return;
    }
  };

  for (const slot of slots) {
    if (CLOSED_FIELDS.has(slot.key)) tryAssign(slot, false);
  }
  for (const slot of slots) {
    if (!CLOSED_FIELDS.has(slot.key)) tryAssign(slot, true);
  }

  const unassigned = clauses
    .filter((_clause, index) => !claimed.has(index))
    .map((clause) => clause.text);

  return { assignments, unassigned };
}

/**
 * 話している途中の文字列から、言い終わった節だけを割り当てる。
 *
 * 文字起こしの増分が届くたびに呼び、読めたマスを 1 つずつ画面へ返すために使う。
 * 末尾の言いかけは捨てるので、途中の値が確定値として出ることはない
 * （`parse` が通らない言いかけは、そもそも割当にならない）。
 */
export function assignTerminated(input: AssignUtteranceInput): {
  assignments: UtteranceAssignment[];
  unassigned: string[];
} {
  const prefix = terminatedPrefix(input.text);
  if (prefix.trim().length === 0) return { assignments: [], unassigned: [] };
  return assignUtterance({ ...input, text: prefix });
}
