import { readProblem } from "@/lib/problem";
import {
  extensionForMimeType,
  MAX_AUDIO_BYTES,
} from "@/modules/events/lib/voice/audio";
import type {
  VoiceFieldScope,
  VoicePatch,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";
import type { EventFormValues } from "@/modules/events/types";

/**
 * 「まとめて話す」の通信。
 *
 * 1 回の録音をそのまま `POST /api/v1/voice/utterances` へ送り、欄ごとの割当を受ける。
 * 値の解釈はサーバー（`parse.ts`）に閉じてあるので、ここでは形を検めるだけで、
 * 値を作り直さない。編集された行の読み直しは、画面側で `field.parse` に通す。
 */
const UTTERANCE_ENDPOINT = "/api/v1/voice/utterances";

const EMPTY_RESULT_MESSAGE = "音声を文字にできませんでした。もう一度話してください。";

export interface VoiceUtteranceAssignment {
  /** 割り当て先のマス（`欄のキー:行`）。 */
  slotId: VoiceSlotId;
  /** 割り当てた節。確認画面の入力の初期値にそのまま使う。 */
  text: string;
  /** サーバーが `parse` から作った差分。 */
  patch: VoicePatch;
  /** サーバーが返した読みやすい値。表示には `text` を使う。 */
  value: string | number | null;
}

export interface VoiceUtteranceResult {
  /** 文字起こしの全文。 */
  text: string;
  assignments: VoiceUtteranceAssignment[];
  /** どの欄にも当たらなかった節。 */
  unassigned: string[];
  model: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 返ってきた割当を検める。形の崩れた行は捨てる（値は `parse` に通す前提を保つ）。 */
function readAssignments(raw: unknown): VoiceUtteranceAssignment[] {
  if (!Array.isArray(raw)) return [];

  const assignments: VoiceUtteranceAssignment[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const slotId = typeof item.slotId === "string" ? item.slotId : null;
    const text = typeof item.text === "string" ? item.text : null;
    const patch = isRecord(item.patch) ? (item.patch as VoicePatch) : null;
    if (!slotId || text === null || patch === null) continue;
    const value =
      typeof item.value === "string" || typeof item.value === "number" ? item.value : null;
    assignments.push({ slotId: slotId as VoiceSlotId, text, patch, value });
  }
  return assignments;
}

function readStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

/**
 * 録音した音声を送り、1 回の発話を複数の欄へ割り当てる。
 *
 * `value` と `scope` は、サーバーが `parse` を当てるための文脈である。
 * 音声は保存せず、認識のためだけに中継される。
 */
export async function transcribeVoiceUtterance(input: {
  blob: Blob;
  value: EventFormValues;
  scope: VoiceFieldScope;
  signal?: AbortSignal;
}): Promise<VoiceUtteranceResult> {
  if (input.blob.size === 0) {
    throw new Error("録音が空でした。もう一度話してください。");
  }
  if (input.blob.size > MAX_AUDIO_BYTES) {
    throw new Error("録音が長すぎます。短く話してください。");
  }

  const mime = input.blob.type || "audio/webm";
  const form = new FormData();
  form.append(
    "audio",
    new File([input.blob], `voice.${extensionForMimeType(mime)}`, { type: mime }),
  );
  form.append("value", JSON.stringify(input.value));
  form.append(
    "scope",
    JSON.stringify({
      showOrganizerName: input.scope.showOrganizerName,
      includeOptional: input.scope.includeOptional,
      touched: [...input.scope.touched],
    }),
  );

  const response = await fetch(UTTERANCE_ENDPOINT, {
    method: "POST",
    body: form,
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(await readProblem(response));
  }

  const body = (await response.json()) as unknown;
  if (!isRecord(body) || typeof body.text !== "string") {
    throw new Error(EMPTY_RESULT_MESSAGE);
  }

  return {
    text: body.text,
    assignments: readAssignments(body.assignments),
    unassigned: readStrings(body.unassigned),
    model: typeof body.model === "string" ? body.model : null,
  };
}
