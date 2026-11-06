import { isSlotNeeded, voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import type {
  VoiceField,
  VoiceFieldScope,
  VoiceSlot,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";
import { groupPricePlanPairs, type EventFormValues } from "@/modules/events/types";

/**
 * 「まとめて話す」の案内。話す順を、いまのフォームの空欄から作る。
 *
 * 固定の例を画面に置くと、欄が埋まったあとも埋まっていない欄の例を読み上げてしまい、
 * 話す順と実際に割り当てられる欄がずれる。案内と割当の対象を同じ `batchTargets` から
 * 作ることで、見えている順に話せばそのとおりに入る。
 *
 * 札（話す順の名前）と例（読み上げの見本）は、かつて別々の配列から作っていた。
 * 片方は重複を除いた種類、もう片方は 6 項までの文字列だったため、5 枚と 6 項のように
 * 数も位置も合わなかった。いまは `batchPlan` の 1 本の並びが、マスの名前と質問を持つ。
 *
 * DOM と Next に依存しない純ロジック。`fields.ts` の定義だけを読む。
 */

/** 話し方。まとめて 1 回で話すか、1 欄ずつ話すか。 */
export type VoiceMode = "batch" | "single";

/** 既定で「まとめて」を選ぶ、空欄の数。1〜2 欄なら 1 つずつ聞いた方が速い。 */
export const BATCH_DEFAULT_MIN_TARGETS = 3;

/**
 * まとめて話すときに埋める対象。巡回順のうち、いま埋めるべきマスだけを返す。
 *
 * `isSlotNeeded` は必須の空欄と、まだ触っていない任意欄を返す。任意欄を外した
 * スコープでは必須の空欄だけになる。入力済みの欄はここに残らないので、
 * 案内にも割当にも出てこない（静かに上書きしない）。
 */
export function batchTargets(
  value: EventFormValues,
  scope: VoiceFieldScope,
): VoiceSlot[] {
  return voiceFieldOrder(value, scope).filter((slot) => isSlotNeeded(slot, value, scope));
}

/**
 * 行を分けて話す必要があるか。日程・男女別・費用プランの組のいずれかが複数なら真。
 *
 * 「まとめて」は 1 行ぶんの並びを前提にしているので、行が複数あると 2 行目以降が
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
 * 「まとめて」を選ぶ（1〜2 欄なら 1 つずつ聞いた方が速い）。
 */
export function defaultVoiceMode(
  targets: readonly VoiceSlot[],
  value: EventFormValues,
): VoiceMode {
  if (hasMultipleRows(value)) return "single";
  return targets.length >= BATCH_DEFAULT_MIN_TARGETS ? "batch" : "single";
}

/** マスに並べる上限。390px で 3 段に収まる長さに抑える（郵便番号まで）。 */
const MAX_CELLS = 7;

/**
 * マスに出す名前と、30px の 1 行に出す質問。
 *
 * 既定は欄そのものの名前と質問（`fields.ts` の `label` / `prompt`）を使う。ここで
 * 差し替えるのは、マスに並べると長いもの（費用プランの名前）、単位を添えないと
 * 何を話すか決まらないもの（金額）、話す順では「場所」で通じるもの（会場名）だけである。
 */
const CELL_TEXT: Partial<Record<VoiceField["key"], { label: string; prompt: string }>> = {
  planName: { label: "費用プラン名", prompt: "費用プラン名は？" },
  planAmount: { label: "費用（～円）", prompt: "費用は？" },
  venueName: { label: "場所", prompt: "場所は？" },
};

/** 開始と終了を 1 枚に畳んだときの名前と質問。 */
const RANGE_TEXT = {
  label: "開始時間と終了時間",
  prompt: "開始時間と終了時間は？",
} as const;

/**
 * まとめて話すときの 1 マス。
 *
 * 画面はこの並びをそのまま縦に置く。名前はマスに出す。まとめては 1 つの欄の話ではないので、
 * 30px の行には質問を進めず、固定の指示（`BATCH_PROMPT`）を置く。
 */
export interface BatchCell {
  /** マスの識別子。読めたかどうかはこの id で持つ。 */
  id: VoiceSlotId;
  /** 1 文で埋まる組（「18時から20時」の開始と終了など）。 */
  slotIds: VoiceSlotId[];
  /** マスに出す欄の名前（「イベント名」）。 */
  label: string;
  /** このマスで聞いていること（「イベント名は？」）。読み上げと確認に使う。 */
  prompt: string;
  /** 話し方の見本（「忘年会」）。マスには出さず、話す 1 文の例にだけ使う。 */
  example: string;
}

/**
 * まとめて話すときに、30px の 1 行へ固定で置く指示。
 *
 * 欄ごとの質問を進めると、話している最中に「いま何を話すか」の 1 行が入れ替わり、
 * 目で追えなくなる。進み具合はマスの塗りだけで示し、値の形は 1 文の例で見せる。
 */
export const BATCH_PROMPT = "以下をまとめて話してください";

/**
 * 話す順を 1 本の並びにする。
 *
 * - 必須の欄を先に、任意の欄を後ろに置く（まず話すことを前へ出す）
 * - 同じ行の開始と終了が続くときは 1 枚に畳む（`scheduleStart` の範囲解釈に合わせる）
 * - 7 枚まで。8 枚目以降は確認のダイアログで扱う
 */
export function batchPlan(targets: readonly VoiceSlot[]): BatchCell[] {
  const byId = new Map<VoiceSlotId, VoiceSlot>(targets.map((slot) => [slot.id, slot]));
  const ordered = [
    ...targets.filter((slot) => !slot.field.optional),
    ...targets.filter((slot) => slot.field.optional),
  ];

  const cells: BatchCell[] = [];
  for (const target of ordered) {
    if (cells.length >= MAX_CELLS) break;

    // 開始が同じ行にあれば、終了は開始のマスに畳んである。
    if (target.key === "scheduleEnd") {
      const start = byId.get(`scheduleStart:${target.row}` as VoiceSlotId);
      if (start) continue;
    }

    const slotIds: VoiceSlotId[] = [target.id];
    let example = target.field.example;
    let range = false;
    if (target.key === "scheduleStart") {
      const end = byId.get(`scheduleEnd:${target.row}` as VoiceSlotId);
      if (end) {
        range = true;
        slotIds.push(end.id);
        example = `${example}から${end.field.example}`;
      }
    }

    cells.push({ id: target.id, slotIds, example, ...cellText(target, range) });
  }
  return cells;
}

/**
 * まとめて話す 1 文の例（「忘年会、12月5日、18時から20時、…」）。
 *
 * マスの名前だけでは、値として何を言えばよいか分からない。話す順に値を並べた
 * 1 文を 1 か所だけ置き、押した直後に読む先を 1 つに絞る。
 */
export function batchExampleSentence(cells: readonly BatchCell[]): string {
  return cells.map((cell) => cell.example).join("、");
}

/**
 * マスの名前と質問を決める。
 *
 * 行や男女別で名前が変わる欄（「2件目の開催日」「女性の金額」）は、`fields.ts` が
 * 作った名前をそのまま使う。差し替えると、どの行の話か分からなくなる。
 */
function cellText(
  slot: VoiceSlot,
  range: boolean,
): { label: string; prompt: string } {
  if (range) return RANGE_TEXT;
  const own = slot.label === slot.field.label ? CELL_TEXT[slot.key] : undefined;
  return own ?? { label: slot.label, prompt: slot.prompt };
}
