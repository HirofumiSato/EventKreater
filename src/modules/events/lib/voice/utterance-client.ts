import { readProblem } from "@/lib/problem";
import {
  extensionForMimeType,
  MAX_AUDIO_BYTES,
} from "@/modules/events/lib/voice/audio";
import { readSseStream, type SseEvent } from "@/modules/events/lib/voice/sse";
import type {
  VoiceFieldScope,
  VoicePatch,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";
import type { EventFormValues } from "@/modules/events/types";

/**
 * 「自由に話す」の通信。
 *
 * 1 回の録音をそのまま `POST /api/v1/voice/utterances` へ送り、欄ごとの割当を受ける。
 * 値の解釈はサーバー（`parse.ts`）に閉じてあるので、ここでは形を検めるだけで、
 * 値を作り直さない。編集された行の読み直しは、画面側で `field.parse` に通す。
 *
 * 応答は `text/event-stream`。割当は最後の `done` にまとめて入っている。
 * 音声から文字起こししたときだけ `delta` が届く（自由文の割当は `done` で行う）。
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

/** `done` の本文を結果へ直す。形が崩れていたら null（読み取り側が失敗にする）。 */
function readDone(raw: unknown): VoiceUtteranceResult | null {
  if (!isRecord(raw) || typeof raw.text !== "string") return null;
  return {
    text: raw.text,
    assignments: readAssignments(raw.assignments),
    unassigned: readStrings(raw.unassigned),
    model: typeof raw.model === "string" ? raw.model : null,
  };
}

/**
 * 1 イベントを読む。知らないイベント名と壊れた JSON は捨てる。
 * `error` だけは本文に理由があるので、投げて呼び出し側へ渡す。
 */
function parseEvent(event: SseEvent): { type: "delta" | "done"; payload: unknown } | null {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;

  if (event.event === "delta") {
    return typeof payload.text === "string"
      ? { type: "delta", payload: payload.text }
      : null;
  }
  if (event.event === "done") {
    return { type: "done", payload };
  }
  if (event.event === "error") {
    throw new Error(
      typeof payload.detail === "string" && payload.detail
        ? payload.detail
        : EMPTY_RESULT_MESSAGE,
    );
  }
  return null;
}

/** `text/event-stream` を読み、`delta` を順に渡して `done` の結果を返す。 */
async function readStreamedResult(
  response: Response,
  options: {
    onDelta?: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<VoiceUtteranceResult> {
  if (!response.body) throw new Error(EMPTY_RESULT_MESSAGE);

  const received: { done: VoiceUtteranceResult | null; text: string } = {
    done: null,
    text: "",
  };

  await readSseStream(
    response.body,
    (event) => {
      const parsed = parseEvent(event);
      if (!parsed) return;

      if (parsed.type === "delta") {
        const text = parsed.payload as string;
        received.text += text;
        options.onDelta?.(text);
        return;
      }
      received.done = readDone(parsed.payload);
    },
    { signal: options.signal },
  );

  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (received.done) return received.done;
  if (received.text) {
    return { text: received.text, assignments: [], unassigned: [], model: null };
  }
  throw new Error(EMPTY_RESULT_MESSAGE);
}

/**
 * 録音した音声、または区間の文字起こしをまとめた全文を送り、
 * 1 回の発話を複数の欄へ割り当てる。
 *
 * `value` と `scope` は、サーバーが `parse` を当てるための文脈である。
 * `text` があれば文字起こしを呼ばず、その文字だけで割当を行う（`blob` は不要）。
 * 音声は保存せず、認識のためだけに中継される。
 */
export async function transcribeVoiceUtterance(input: {
  /** 録音。`text` があるときは不要。 */
  blob?: Blob;
  /** 区間の文字起こしをまとめた全文。あればこちらを割当に使う。 */
  text?: string;
  value: EventFormValues;
  scope: VoiceFieldScope;
  /** 聞き取れた分が届くたびに呼ばれる（音声から文字起こししたときだけ）。 */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<VoiceUtteranceResult> {
  const text = input.text?.trim();

  const form = new FormData();
  if (text) {
    form.append("text", text);
  } else {
    if (!input.blob) {
      throw new Error("録音が空でした。もう一度話してください。");
    }
    if (input.blob.size === 0) {
      throw new Error("録音が空でした。もう一度話してください。");
    }
    if (input.blob.size > MAX_AUDIO_BYTES) {
      throw new Error("録音が長すぎます。短く話してください。");
    }
    const mime = input.blob.type || "audio/webm";
    form.append(
      "audio",
      new File([input.blob], `voice.${extensionForMimeType(mime)}`, { type: mime }),
    );
  }
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

  // 古いサーバーや、応答をためるプロキシは JSON で返す。中身の種類で読み分ける。
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    return readStreamedResult(response, {
      onDelta: input.onDelta,
      signal: input.signal,
    });
  }

  const body = (await response.json()) as unknown;
  const result = readDone(body);
  if (!result) throw new Error(EMPTY_RESULT_MESSAGE);
  return result;
}
