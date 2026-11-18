import { isSlotNeeded, voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import type {
  VoiceField,
  VoiceFieldScope,
  VoiceSlot,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";
import { groupPricePlanPairs, type EventFormValues } from "@/modules/events/types";

/**
 * 音声入力の案内。自由文を 1 回で話すか、1 欄ずつ話すかの既定と、
 * 自由文で埋める対象（いまの空欄）を決める。
 *
 * `batchPlan` が返す一覧は参考表示である。割当は話し終えた原文から行うので、
 * 並び順どおりに話す必要はない（「12月5日の18時から20時に渋谷ホールで忘年会」の
 * ように、1 文へ日付・時刻・場所・名前が混ざってよい）。
 * 一覧は「いま空欄の欄」を巡回順（必須を先、任意を後ろ）で並べた目安にすぎず、
 * 読み上げながら塗るマスは持たない。値が入るかどうかは停止後の確認で決める。
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

/** 一覧に並べる上限。390px で 3 段に収まる長さに抑える（郵便番号まで）。 */
const MAX_CELLS = 8;

/**
 * 一覧に出す名前。既定は欄そのものの名前（`fields.ts` の `label`）を使う。
 * ここで差し替えるのは、並べると長いもの（料金プラン名）、単位を添えないと
 * 何を話すか決まらないもの（金額）、一覧では「場所」で通じるもの（会場名）、
 * 口に出しやすい言い方に寄せるもの（開始時間・終了時間）だけである。
 */
const CELL_TEXT: Partial<Record<VoiceField["key"], { label: string }>> = {
  scheduleStart: { label: "開始時間" },
  scheduleEnd: { label: "終了時間" },
  planName: { label: "料金プラン名" },
  planAmount: { label: "料金（円）" },
  venueName: { label: "場所" },
};

/**
 * 一覧に並べる 1 マス。参考表示なので、話した順に塗ったりはしない。
 */
export interface BatchCell {
  /** マスの識別子。 */
  id: VoiceSlotId;
  /** マスに出す欄の名前（「イベント名」）。 */
  label: string;
}

/**
 * 一覧と確認のダイアログで共通の並び。必須の欄を先に、任意の欄を後ろに置く。
 *
 * 一覧（`batchPlan`）と確認の行（`orderByBatchPlan`）の両方がこれを使う。
 * 2 か所で別々に並べると、パネルで「1. イベント名」と言った欄が確認では
 * 5 行目に出る、といった食い違いが起きる。
 */
export function batchOrderedTargets(targets: readonly VoiceSlot[]): VoiceSlot[] {
  return [
    ...targets.filter((slot) => !slot.field.optional),
    ...targets.filter((slot) => slot.field.optional),
  ];
}

/**
 * 割当を、一覧（`batchPlan`）と同じ欄の順へ並べ替える。
 *
 * 割当は原文から引くので、返る順は話した順になる（日付・金額・郵便番号…）。
 * そのまま確認に並べると、パネルの一覧（イベント名・開催日・開始時間…）と
 * 順が食い違う。一覧に無い欄（9 枚目以降の都道府県・建物名など）は後ろへ回し、
 * 元の並びを保つ（`Array#sort` は安定なので、同順位は入力の順のまま）。
 */
export function orderByBatchPlan<T extends { slotId: VoiceSlotId }>(
  rows: readonly T[],
  targets: readonly VoiceSlot[],
): T[] {
  const order = new Map(batchOrderedTargets(targets).map((slot, index) => [slot.id, index]));
  const last = Number.MAX_SAFE_INTEGER;
  return [...rows].sort(
    (a, b) => (order.get(a.slotId) ?? last) - (order.get(b.slotId) ?? last),
  );
}

/**
 * 話す順の目安を 1 本の並びにする。割当はこの順に依存しない。
 *
 * - 必須の欄を先に、任意の欄を後ろに置く（まず話すことを前へ出す）
 * - 8 枚まで。9 枚目以降は確認のダイアログで扱う
 * - 開始と終了も別のマスにし、名前を 1 行に収める
 */
export function batchPlan(targets: readonly VoiceSlot[]): BatchCell[] {
  return batchOrderedTargets(targets)
    .slice(0, MAX_CELLS)
    .map((slot) => ({
      id: slot.id,
      // 行付きの名前（「2件目の開始時刻」）は fields.ts の名前をそのまま使う。
      label:
        (slot.label === slot.field.label ? CELL_TEXT[slot.key]?.label : undefined) ?? slot.label,
    }));
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
