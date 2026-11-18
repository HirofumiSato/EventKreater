import { isSlotNeeded, voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import type {
  VoiceFieldScope,
  VoiceSlot,
} from "@/modules/events/lib/voice/types";
import { groupPricePlanPairs, type EventFormValues } from "@/modules/events/types";

/**
 * 音声入力の案内。自由文を 1 回で話すか、1 欄ずつ話すかの既定と、
 * 自由文で埋める対象（いまの空欄）を決める。
 *
 * 以前は「話す順」のマス（`batchPlan`）を持ち、読点で切った 1 節＝1 欄で割り当てていた。
 * 自然な文では話す順が決まらない（「12月5日の18時から20時に渋谷ホールで忘年会」の
 * ように、1 文へ日付・時刻・場所・名前が混ざる）ため、マスと途中の割当はやめた。
 * いまは話し終えた原文から欄ごとの値の範囲を抜き出して割り当てるので、
 * 話す前に見せる順も、喋りながら塗るマスも持たない。
 *
 * DOM と Next に依存しない純ロジック。`fields.ts` の定義だけを読む。
 */

/** 話し方。自由文を 1 回で話すか、1 欄ずつ話すか（内部の名前は `batch` のまま）。 */
export type VoiceMode = "batch" | "single";

/** 既定で「自由に話す」を選ぶ、空欄の数。1〜2 欄なら 1 つずつ聞いた方が速い。 */
export const BATCH_DEFAULT_MIN_TARGETS = 3;

/**
 * 自由文で埋める対象。巡回順のうち、いま埋めるべき欄だけを返す。
 *
 * `isSlotNeeded` は必須の空欄と、まだ触っていない任意欄を返す。任意欄を外した
 * スコープでは必須の空欄だけになる。入力済みの欄はここに残らないので、
 * 案内にも割当にも出てこない（静かに上書きしない）。
 *
 * 自由文でも「どの欄を対象にするか」は変わらない。話し終えたあとの割当も、
 * 確認ダイアログの行も、この並びから作る。
 */
export function batchTargets(
  value: EventFormValues,
  scope: VoiceFieldScope,
): VoiceSlot[] {
  return voiceFieldOrder(value, scope).filter((slot) => isSlotNeeded(slot, value, scope));
}

/**
 * 行を分けて話す必要があるか。日程・男女別・料金プランの組のいずれかが複数なら真。
 *
 * 自由文の割当は 1 行ぶんの値を前提にしているので、行が複数あると 2 行目以降が
 * 行き止まりになる。入口の既定を決める前に、ここで行の複雑さを見る。
 */
export function hasMultipleRows(value: EventFormValues): boolean {
  if (value.schedules.length > 1) return true;
  if (value.pricePlans.some((plan) => plan.audience !== "ANY")) return true;
  return groupPricePlanPairs(value.pricePlans).length > 1;
}

/**
 * 話し方の既定を決める。
 *
 * 行が複数あるときは「1つずつ」。1 行だけなら、空欄が 3 つ以上のときに
 * 「自由に話す」を選ぶ（1〜2 欄なら 1 つずつ聞いた方が速い）。
 */
export function defaultVoiceMode(
  targets: readonly VoiceSlot[],
  value: EventFormValues,
): VoiceMode {
  if (hasMultipleRows(value)) return "single";
  return targets.length >= BATCH_DEFAULT_MIN_TARGETS ? "batch" : "single";
}

/**
 * 自由文の見本。パネルの「話し方の例：」のあとに置く。
 *
 * 話す順を並べた見本（「忘年会、12月5日、…」）は、実際に話してよい形と違う。
 * 値の並びではなく 1〜2 文の自然な文を 1 つだけ見せ、日付・時刻・場所・料金・
 * 定員を 1 回で言ってよいことを伝える。欄ごとの見本は、1 つずつ話すモードの
 * 質問の横（`fields.ts` の `example`）に任せる。
 */
export function freeformExampleSentence(): string {
  return "忘年会を12月5日の18時から20時に渋谷ホールで開きます。参加費は3000円、定員は30人です。";
}
