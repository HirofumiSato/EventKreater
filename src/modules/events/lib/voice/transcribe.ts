import { readProblem } from "@/lib/problem";
import { extensionForMimeType, MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import { parseVoiceStreamEvent, readSseStream } from "@/modules/events/lib/voice/sse";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

const VOICE_ENDPOINT = "/api/v1/voice/transcriptions";

/**
 * モックの可否を聞く待ち時間。
 *
 * 音声モードは開いた瞬間に録音を始めるため、この返事が遅いと録音の開始も遅れる。
 * 待ちは短く切り、超えたら実の録音へ倒す（本番は常に false なので、待つ意味も無い）。
 */
const MOCK_QUERY_TIMEOUT_MS = 1_500;

/**
 * モックが有効かを聞く。
 *
 * モックの可否はサーバーの環境変数が決める。画面は録音を省いてよいかを知るために、
 * 音声モードを開いたときに 1 度だけ聞く（欄ごとには聞かない）。
 * 聞けなければ false（実の録音をする）に倒す。返事が遅いときも同じく打ち切る。
 */
export async function fetchVoiceMockEnabled(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MOCK_QUERY_TIMEOUT_MS);
  try {
    const response = await fetch(VOICE_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { mock?: unknown };
    return body.mock === true;
  } catch {
    // 通信の失敗も打ち切りも、実の録音に倒す。
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface TranscribeResult {
  text: string;
}

/**
 * 認識の手掛かり。欄そのものの現在値は送らない（言い直しが効かなくなるため）。
 * 入力済みの催し名と会場名だけを、当て字を寄せるために添える。
 */
export interface VoiceTranscribeContext {
  /** 対象の行。0 から `MAX_EVENT_OPTIONS - 1` まで。 */
  row?: number;
  /** 入力済みの催し名。 */
  title?: string;
  /** 入力済みの会場名。 */
  venueName?: string;
}

const EMPTY_RESULT_MESSAGE = "音声を文字にできませんでした。もう一度話してください。";

/**
 * `text/event-stream` の応答を読む。`delta` をそのまま `onDelta` へ渡し、
 * `done` の本文を返す。`error` は利用者向けの文言だけを `Error` にして投げる。
 */
async function readStreamedResult(
  response: Response,
  options: { onDelta?: (text: string) => void; signal?: AbortSignal },
): Promise<TranscribeResult> {
  if (!response.body) throw new Error(EMPTY_RESULT_MESSAGE);

  const received: { done: string | null; streamed: string } = { done: null, streamed: "" };

  await readSseStream(
    response.body,
    (event) => {
      const parsed = parseVoiceStreamEvent(event);
      if (!parsed) return;

      if (parsed.type === "delta") {
        received.streamed += parsed.text;
        options.onDelta?.(parsed.text);
        return;
      }
      if (parsed.type === "done") {
        received.done = parsed.text;
        return;
      }
      // 途中の失敗は本文に書かれる。本文はすでに流れているので、ここで投げる。
      throw new Error(parsed.detail || EMPTY_RESULT_MESSAGE);
    },
    { signal: options.signal },
  );

  // 画面が切れたときは、本文が揃っていなくても成功にしない。
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const text = received.done ?? (received.streamed || null);
  if (text === null) throw new Error(EMPTY_RESULT_MESSAGE);
  return { text };
}

/**
 * 録音した音声をサーバーへ送り、文字にする。
 * 音声は保存せず、認識のためだけに OpenAI へ中継する。
 *
 * `onDelta` を渡すと、サーバーは `text/event-stream` で途中経過を返す。
 * 渡さない（またはサーバーが JSON を返す）ときは、従来どおり 1 回で受ける。
 */
export async function transcribeVoiceClip(input: {
  blob: Blob;
  field: VoiceFieldKey | null;
  /** 欄の文脈。当て字の手掛かりで、無くても認識は動く。 */
  context?: VoiceTranscribeContext;
  /** 認識できた分から順に呼ばれる。増分で、最後の本文は戻り値で返す。 */
  onDelta?: (text: string) => void;
  /** キャンセル。渡すと通信と読み取りを止める。 */
  signal?: AbortSignal;
}): Promise<TranscribeResult> {
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
  if (input.field) form.append("field", input.field);
  // 行と当て字の手掛かりは、キーを固定して値だけを載せる。サーバー側で検証してから使う。
  if (input.context?.row !== undefined) form.append("row", String(input.context.row));
  if (input.context?.title) form.append("title", input.context.title);
  if (input.context?.venueName) form.append("venueName", input.context.venueName);

  const response = await fetch(VOICE_ENDPOINT, {
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
    return readStreamedResult(response, { onDelta: input.onDelta, signal: input.signal });
  }

  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string") {
    throw new Error(EMPTY_RESULT_MESSAGE);
  }
  return { text: body.text };
}

/* ------------------------------------------------------------------------- *
 * 録音中の区間
 *
 * 録音を止めるまで待つと、最初の文字が出るまで話し終えてから数秒かかる。
 * 無音で切った区間（2.5 秒〜6 秒）を録音中に送り、返った文字から順に画面へ出す。
 * 停止したあとは、ここで集めた全文をそのまま確定に使う（同じ音声を二度送らない）。
 * ------------------------------------------------------------------------- */

/** 区間の文字起こしの結果。`model` は使った認識モデル（分からなければ null）。 */
export interface VoiceSegmentResult {
  text: string;
  model: string | null;
}

/**
 * モック（`VOICE_TRANSCRIBE_MOCK=1`）で区間ごとに返す文。
 * 3 つつなぐと `freeformExampleSentence()` の見本と同じ 1 文になる。
 * 画面も同じ並びを使って、疑似的に文字が増える様子を見せる。
 */
export const MOCK_VOICE_SEGMENT_TEXTS = [
  "忘年会を12月5日の",
  "18時から20時に渋谷ホールで",
  "開きます。参加費は3000円、定員は30人です。",
] as const;

/**
 * モックかどうかの返事。区間は 2.5 秒ごとに来るので、区間ごとに聞き直さない。
 * 本番は常に false なので、最初の 1 回で足りる。
 */
let mockEnabledPromise: Promise<boolean> | null = null;

function voiceMockEnabledOnce(): Promise<boolean> {
  mockEnabledPromise ??= fetchVoiceMockEnabled();
  return mockEnabledPromise;
}

/** モックで返す区間の文の位置。`sessionId` が変わったら先頭へ戻す（1 録音で 1 巡）。 */
let mockSegmentSessionId: string | null = null;
let mockSegmentIndex = 0;

function mockVoiceSegmentText(sessionId: string): string {
  if (mockSegmentSessionId !== sessionId) {
    mockSegmentSessionId = sessionId;
    mockSegmentIndex = 0;
  }
  const text = MOCK_VOICE_SEGMENT_TEXTS[mockSegmentIndex] ?? "";
  mockSegmentIndex += 1;
  return text;
}

/**
 * 区間の応答を読む。`done` の本文と、使ったモデル名だけを受ける。
 *
 * `delta` は読むだけで表示には使わない。区間は 6 秒までなので `done` までに
 * 1 秒もかからず、増分を並べると同じ文が二重に出るだけになる。
 * `model` は `parseVoiceStreamEvent` が落とすため、ここでは `data` を直接読む。
 */
async function readSegmentResult(
  response: Response,
  options: { signal?: AbortSignal },
): Promise<VoiceSegmentResult> {
  if (!response.body) throw new Error(EMPTY_RESULT_MESSAGE);

  const received: { done: string | null; model: string | null; streamed: string } = {
    done: null,
    model: null,
    streamed: "",
  };

  await readSseStream(
    response.body,
    (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        // 途中で切れた JSON は次のイベントで直る。ここでは捨てるだけ。
        return;
      }
      if (typeof payload !== "object" || payload === null) return;
      const record = payload as Record<string, unknown>;

      if (event.event === "delta") {
        if (typeof record.text === "string") received.streamed += record.text;
        return;
      }
      if (event.event === "done") {
        if (typeof record.text === "string") received.done = record.text;
        if (typeof record.model === "string") received.model = record.model;
        return;
      }
      if (event.event === "error") {
        throw new Error(
          typeof record.detail === "string" && record.detail
            ? record.detail
            : EMPTY_RESULT_MESSAGE,
        );
      }
    },
    { signal: options.signal },
  );

  // 画面が切れたときは、本文が揃っていなくても成功にしない。
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const text = received.done ?? (received.streamed || null);
  if (text === null) throw new Error(EMPTY_RESULT_MESSAGE);
  return { text, model: received.model };
}

/**
 * 録音中に切った区間を送り、その区間の文字を受け取る。
 *
 * `transcribeVoiceClip` とは別の入口にしてある。区間には欄が決まっていないので
 * `field` / `row` / `title` / `venueName` を送らず、汎用の文脈で認識させる。
 * `sessionId` は 1 録音で 1 つ。サーバーは同じ録音の区間を 1 回ぶんとして数える。
 * `onDelta` は渡さない（区間が短いので、`done` の全文だけで足りる）。
 */
export async function transcribeVoiceSegment(input: {
  blob: Blob;
  /** 1 録音ぶんの識別子。録音の開始ごとに画面が作る。 */
  sessionId: string;
  signal?: AbortSignal;
}): Promise<VoiceSegmentResult> {
  if (input.blob.size === 0) {
    throw new Error("録音が空でした。もう一度話してください。");
  }
  if (input.blob.size > MAX_AUDIO_BYTES) {
    throw new Error("録音が長すぎます。短く話してください。");
  }

  // モックは外部へ出さない。区間ごとに見本の文を 1 つずつ返す。
  if (await voiceMockEnabledOnce()) {
    return { text: mockVoiceSegmentText(input.sessionId), model: null };
  }

  const mime = input.blob.type || "audio/wav";
  const form = new FormData();
  form.append(
    "audio",
    new File([input.blob], `voice.${extensionForMimeType(mime)}`, { type: mime }),
  );
  form.append("sessionId", input.sessionId);

  const response = await fetch(VOICE_ENDPOINT, {
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
    return readSegmentResult(response, { signal: input.signal });
  }

  const body = (await response.json()) as { text?: unknown; model?: unknown };
  if (typeof body.text !== "string") {
    throw new Error(EMPTY_RESULT_MESSAGE);
  }
  return { text: body.text, model: typeof body.model === "string" ? body.model : null };
}
