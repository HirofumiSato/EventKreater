import { isSlotNeeded, voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import type { VoiceFieldScope, VoiceSlot, VoiceSlotId } from "@/modules/events/lib/voice/types";
import type { EventFormValues } from "@/modules/events/types";

/**
 * 「まとめて話す」の案内。話す順と例を、いまのフォームの空欄から作る。
 *
 * 固定の例を画面に置くと、欄が埋まったあとも埋まっていない欄の例を読み上げてしまい、
 * 話す順と実際に割り当てられる欄がずれる。案内と割当の対象を同じ `batchTargets` から
 * 作ることで、見えている順に話せばそのとおりに入る。
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

/** 空欄が 3 つ以上なら「まとめて」を既定にする。 */
export function defaultVoiceMode(targets: readonly VoiceSlot[]): VoiceMode {
  return targets.length >= BATCH_DEFAULT_MIN_TARGETS ? "batch" : "single";
}

/** 例に並べる上限。 */
const MAX_EXAMPLE_ITEMS = 6;

/** ステップごとの短い名前。巡回順に重複を除いて返す。 */
export function batchSteps(targets: readonly VoiceSlot[]): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const name = shortStepName(target);
    if (seen.has(name)) continue;
    seen.add(name);
    steps.push(name);
  }
  return steps;
}

/**
 * 例。`field.example` を巡回順に `、` でつなぐ。
 *
 * - 必須の欄を先に、任意の欄を後ろに置く（例は「まず話すこと」を見せる）
 * - 同じ行の開始と終了が続くときは「18時から20時」の 1 項に畳む
 *   （`scheduleStart` の範囲解釈に合わせる）
 * - 6 項まで。390px で 2 行に収まる長さに抑える
 */
export function batchExample(targets: readonly VoiceSlot[]): string {
  const byId = new Map<VoiceSlotId, VoiceSlot>(targets.map((slot) => [slot.id, slot]));
  const ordered = [
    ...targets.filter((slot) => !slot.field.optional),
    ...targets.filter((slot) => slot.field.optional),
  ];

  const items: string[] = [];
  const seen = new Set<string>();
  for (const target of ordered) {
    if (items.length >= MAX_EXAMPLE_ITEMS) break;

    // 開始が同じ行にあれば、終了は開始の項に畳んである。
    if (target.key === "scheduleEnd") {
      const start = byId.get(`scheduleStart:${target.row}` as VoiceSlotId);
      if (start) continue;
    }

    let text = target.field.example;
    if (target.key === "scheduleStart") {
      const end = byId.get(`scheduleEnd:${target.row}` as VoiceSlotId);
      if (end) text = `${text}から${end.field.example}`;
    }

    if (seen.has(text)) continue;
    seen.add(text);
    items.push(text);
  }
  return items.join("、");
}

function shortStepName(slot: VoiceSlot): string {
  switch (slot.key) {
    case "title":
    case "organizerName":
      return "名前";
    case "scheduleDate":
    case "scheduleStart":
    case "scheduleEnd":
      return "日時";
    case "planName":
    case "planAmount":
    case "planNote":
      return "費用";
    case "venueName":
    case "postalCode":
    case "prefecture":
    case "city":
    case "town":
    case "addressLine":
    case "building":
    case "rainPolicy":
      return "会場";
    case "capacity":
    case "rsvpDeadline":
      return "定員";
    default:
      return "その他";
  }
}
