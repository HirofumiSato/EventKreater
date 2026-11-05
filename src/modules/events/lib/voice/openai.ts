import { ProblemDetailException } from "@/lib/exceptions";
import { voiceFieldByKey } from "@/modules/events/lib/voice/fields";
import { isVoiceMockEnabled, mockTranscript } from "@/modules/events/lib/voice/mock";
import { cleanTranscript } from "@/modules/events/lib/voice/normalize";
import { buildVoiceKeywords, buildVoicePrompt } from "@/modules/events/lib/voice/prompt";
import { createSseParser, type SseEvent } from "@/modules/events/lib/voice/sse";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

/**
 * 音声認識（OpenAI）への問い合わせ。
 * 音声は保存せず、認識結果の文字だけを返す。
 */

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";

/** 1 回で返る JSON の待ち時間。従来の値を据え置く。 */
const TRANSCRIBE_TIMEOUT_MS = 25_000;

/** ストリーミングで最初の delta を待つ時間。 */
const FIRST_DELTA_TIMEOUT_MS = 10_000;

/** ストリーミングで次の delta を待つ時間。delta が来るたびに測り直す。 */
const DELTA_TIMEOUT_MS = 15_000;

/**
 * 既定のモデル。`gpt-transcribe` は `gpt-4o-mini-transcribe` より語彙に強く、
 * 短文の聞き取りで Chrome の Web Speech に負けにくい。
 * `VOICE_TRANSCRIBE_MODEL` で差し替えられる。
 */
export const DEFAULT_VOICE_MODEL = "gpt-transcribe";

/**
 * 既定の控えのモデル。`gpt-transcribe` がアカウントで使えないときに 1 度だけ試す。
 * `VOICE_TRANSCRIBE_FALLBACK_MODEL` で差し替えられる。
 */
export const DEFAULT_VOICE_FALLBACK_MODEL = "gpt-4o-mini-transcribe";

export function voiceModel(): string {
  const configured = process.env.VOICE_TRANSCRIBE_MODEL?.trim();
  return configured ? configured : DEFAULT_VOICE_MODEL;
}

export function voiceFallbackModel(): string {
  const configured = process.env.VOICE_TRANSCRIBE_FALLBACK_MODEL?.trim();
  return configured ? configured : DEFAULT_VOICE_FALLBACK_MODEL;
}

/**
 * 音声の言語。この画面は日本語の入力だけを扱うので固定にする。
 * 別の言語で試すときだけ `VOICE_TRANSCRIBE_LANGUAGE` で差し替える。
 */
export const VOICE_LANGUAGE = "ja";

export function voiceLanguage(): string {
  const configured = process.env.VOICE_TRANSCRIBE_LANGUAGE?.trim();
  return configured ? configured : VOICE_LANGUAGE;
}

/** 鍵が無ければ音声入力は使えない。画面は手入力へ戻る。モックが有効なら鍵は要らない。 */
export function isVoiceTranscriptionConfigured(): boolean {
  return isVoiceMockEnabled() || Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * ストリームを始める前の確認。鍵もモックも無ければ 503 を投げる。
 * 本文を流し始めてからではステータスを変えられないため、ルートが先に呼ぶ。
 */
export function assertVoiceConfigured(): void {
  if (isVoiceTranscriptionConfigured()) return;
  throw unavailable(
    "音声入力は現在利用できません（OPENAI_API_KEY が未設定です）。手で入力してください。",
  );
}

interface OpenAiErrorBody {
  error?: { message?: string; type?: string; code?: string; param?: string };
}

interface TranscriptionInput {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  field: VoiceFieldKey | null;
  /** 対象の行。「2件目の開催日」「女性の金額」の言い方に使う。 */
  row?: number;
  /** 入力済みの催し名。当て字の手掛かりとしてだけ使う。 */
  title?: string | null;
  /** 入力済みの会場名。当て字の手掛かりとしてだけ使う。 */
  venueName?: string | null;
  /**
   * 途中経過を受け取る。渡したときだけ上流へ `stream=true` を送り、
   * 認識できた分から順に呼ぶ（本文は増分で、最後の `done` が全文）。
   */
  onDelta?: (text: string) => void;
  /** 画面が切れたときに上流も切るための signal。 */
  signal?: AbortSignal;
}

/** 認識の結果。`model` は実際に使ったモデル（控えへ落ちたときは控えの名前）。 */
export interface VoiceTranscriptionResult {
  text: string;
  model: string;
}

/** 上流の応答を、利用者へ返す扱いの種類に分ける。 */
type UpstreamKind = "model" | "context" | "rate" | "auth" | "audio" | "other";

function unavailable(detail: string): ProblemDetailException {
  return new ProblemDetailException({
    status: 503,
    title: "Voice Unavailable",
    detail,
    error: "TRANSCRIBE_DISABLED",
  });
}

/**
 * モデルと文脈（`prompt` / `keywords` / `languages`）の誤り。
 * 上流の 400 をそのまま「音声が悪い」と扱わず、設定の誤りとして区別する。
 */
function contextInvalid(): ProblemDetailException {
  return new ProblemDetailException({
    status: 422,
    title: "Validation Error",
    detail: "音声認識の設定を読み取れませんでした。もう一度話すか、手で入力してください。",
    error: "TRANSCRIBE_CONTEXT_INVALID",
  });
}

function upstreamFailure(kind: UpstreamKind): ProblemDetailException {
  if (kind === "model" || kind === "context") return contextInvalid();
  if (kind === "rate") {
    return new ProblemDetailException({
      status: 429,
      title: "Too Many Requests",
      detail: "音声認識が混み合っています。少し待ってからもう一度お試しください。",
      error: "TRANSCRIBE_BUSY",
    });
  }
  if (kind === "auth") {
    return new ProblemDetailException({
      status: 502,
      title: "Voice Unavailable",
      detail: "音声認識の設定が正しくありません。管理者に連絡してください。",
      error: "TRANSCRIBE_MISCONFIGURED",
    });
  }
  if (kind === "audio") {
    return new ProblemDetailException({
      status: 422,
      title: "Validation Error",
      detail: "音声を読み取れませんでした。もう一度話すか、手で入力してください。",
      error: "TRANSCRIBE_UNSUPPORTED",
    });
  }
  return new ProblemDetailException({
    status: 502,
    title: "Voice Unavailable",
    detail: "音声認識に接続できませんでした。手で入力してください。",
    error: "TRANSCRIBE_FAILED",
  });
}

function networkFailure(): ProblemDetailException {
  return new ProblemDetailException({
    status: 502,
    title: "Voice Unavailable",
    detail: "音声認識に接続できませんでした。通信状況を確認するか、手で入力してください。",
    error: "TRANSCRIBE_FAILED",
  });
}

/**
 * モデルそのものが無い・使えないという応答か。
 * 「このモデルは keywords を知らない」も、控えのモデルなら通るためここに含める。
 */
function isModelError(status: number, param: string, code: string, message: string): boolean {
  if (status === 404) return true;
  if (param === "model") return true;
  if (code === "model_not_found" || code === "model_not_supported") return true;
  if (!/model/.test(`${code} ${message}`)) return false;
  return /(does not exist|not found|not available|unsupported|not supported|invalid model|unknown model)/.test(
    message,
  );
}

/** `prompt` の長さ超過や `keywords` の禁止文字など、文脈の組み立ての誤りか。 */
function isContextError(param: string, code: string, message: string): boolean {
  if (
    param === "prompt" ||
    param === "language" ||
    param.startsWith("keywords") ||
    param.startsWith("languages")
  ) {
    return true;
  }
  const text = `${param} ${code} ${message}`;
  return (
    /(prompt|keyword|languages?)/.test(text) &&
    /(invalid|unsupported|not supported|unrecognized|unknown|too long|maximum|max length|not allowed|not permitted|must be)/.test(
      message,
    )
  );
}

function classifyUpstream(status: number, body: OpenAiErrorBody | null): UpstreamKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";

  const error = body?.error;
  const param = (error?.param ?? "").toLowerCase();
  const code = (error?.code ?? "").toLowerCase();
  const message = (error?.message ?? "").toLowerCase();

  if (isModelError(status, param, code, message)) return "model";
  if (isContextError(param, code, message)) return "context";
  if (status === 400 || status === 413 || status === 415) return "audio";
  return "other";
}

/**
 * 上流の本文は利用者に見せない（鍵や内部の事情が混ざりうる）。
 * どのパラメータで落ちたかだけを、調査用にログへ残す。
 */
function logUpstreamFailure(
  model: string,
  status: number,
  body: OpenAiErrorBody | null,
  kind: UpstreamKind,
): void {
  const error = body?.error;
  const parts = [
    `status=${status}`,
    `kind=${kind}`,
    `model=${model}`,
    error?.code ? `code=${error.code}` : null,
    error?.param ? `param=${error.param}` : null,
    error?.message ? `message=${error.message}` : null,
  ].filter((part): part is string => Boolean(part));
  console.warn(`[voice] transcription failed: ${parts.join(" ")}`);
}

/**
 * `gpt-transcribe` 系は `languages[]`（配列）と `keywords[]` を受け、`language` は受けない。
 * `gpt-4o-transcribe*` と `whisper-1` は `language` だけを受ける。
 */
function voiceModelFamily(model: string): "context" | "legacy" {
  const normalized = model.trim().toLowerCase();
  return normalized === "gpt-transcribe" || normalized.startsWith("gpt-transcribe-")
    ? "context"
    : "legacy";
}

function buildForm(
  model: string,
  input: TranscriptionInput,
  prompt: string,
  keywords: readonly string[],
  stream: boolean,
): FormData {
  const form = new FormData();
  // Uint8Array の裏の ArrayBuffer は SharedArrayBuffer のこともある。
  // Blob は ArrayBuffer しか受けないため、必要な範囲を切り出して渡す。
  const buffer = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;
  form.append("file", new Blob([buffer], { type: input.contentType }), input.filename);
  form.append("model", model);
  // どちらの系統も json と text を受ける。verbose_json は送らない。
  form.append("response_format", "json");
  // 途中経過が要るときだけ stream を立てる。無いときは従来どおり 1 回で受ける。
  if (stream) form.append("stream", "true");

  if (voiceModelFamily(model) === "context") {
    // `languages` と `language` は併用できない。`gpt-transcribe` では配列だけを送る。
    form.append("languages[]", voiceLanguage());
    // 語彙は 1 語 1 つ。禁止文字は `buildVoiceKeywords` が落としている。
    for (const keyword of keywords) form.append("keywords[]", keyword);
  } else {
    // 旧系統には `keywords` / `languages` を送らない。
    form.append("language", voiceLanguage());
  }

  if (prompt) form.append("prompt", prompt);
  return form;
}

/**
 * タイムアウト付きの signal を作る。画面が切れたときの `AbortSignal` も同じ
 * controller へ繋ぎ、`cancel()` で後片付けする。
 */
function timeoutSignal(
  ms: number,
  external?: AbortSignal,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  external?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * 上流を 1 回呼ぶ。タイマーは本文を読み終えるまで止めない（読み取り中の
 * 停止も 25 秒に含めるため）。呼び出し側は必ず `dispose()` を呼ぶ。
 */
async function postTranscription(
  apiKey: string,
  form: FormData,
  signal?: AbortSignal,
): Promise<{ response: Response; dispose: () => void }> {
  const timeout = timeoutSignal(TRANSCRIBE_TIMEOUT_MS, signal);
  try {
    const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: timeout.signal,
    });
    return { response, dispose: timeout.cancel };
  } catch {
    timeout.cancel();
    throw networkFailure();
  }
}

async function readUpstreamError(response: Response): Promise<OpenAiErrorBody | null> {
  return (await response.json().catch(() => null)) as OpenAiErrorBody | null;
}

/** 上流の 1 回ぶんの結果。失敗のときは、控えのモデルへ落とすかの判断に `kind` を使う。 */
type AttemptResult =
  | { ok: true; text: string; model: string }
  | { ok: false; kind: UpstreamKind; status: number };

function parseUpstreamJson(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // 途中で切れた JSON は捨てる。次のイベントが来れば直る。
    return null;
  }
}

/**
 * 上流のイベント名。`event:` が無い（`message`）実装でも読めるよう、
 * 本文の `type` も見る。知らない名前は呼び出し側で捨てる。
 */
function upstreamEventName(event: SseEvent, payload: Record<string, unknown> | null): string {
  if (event.event !== "message") return event.event;
  return payload && typeof payload.type === "string" ? payload.type : event.event;
}

/** `transcript.text.delta` の増分。`delta` が無い形でも `text` で受ける。 */
function upstreamDeltaText(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (typeof payload.delta === "string") return payload.delta;
  if (typeof payload.text === "string") return payload.text;
  return null;
}

/** `transcript.text.done` の全文。`text` が無い形でも `transcript` で受ける。 */
function upstreamDoneText(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.transcript === "string") return payload.transcript;
  return null;
}

/**
 * 上流の `text/event-stream` を読み、増分を `onDelta` へ渡す。
 *
 * 読めたイベントのたびに `onActivity` を呼び、呼び出し側がタイマーを測り直す。
 * 最後の `transcript.text.done` の全文を返し、それが無ければ増分を連結して返す。
 */
async function readUpstreamStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  onActivity: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const result: { accumulated: string; done: string | null } = {
    accumulated: "",
    done: null,
  };

  const handle = (event: SseEvent): void => {
    const payload = parseUpstreamJson(event.data);
    const name = upstreamEventName(event, payload);

    if (name === "transcript.text.delta") {
      const delta = upstreamDeltaText(payload);
      if (delta) {
        result.accumulated += delta;
        onDelta(delta);
      }
      onActivity();
      return;
    }
    if (name === "transcript.text.done") {
      result.done = upstreamDoneText(payload);
      onActivity();
      return;
    }
    if (name === "error") {
      // 上流の本文は利用者に見せない。調査用にログだけへ残す。
      console.warn("[voice] transcription stream failed:", event.data.slice(0, 500));
      throw upstreamFailure("other");
    }
    // 知らない type（heartbeat など）は捨てる。
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) handle(event);
    }
    // 最後の 1 文字（不完全な UTF-8）と、空行なしで終わったイベントを流し切る。
    for (const event of parser.push(decoder.decode())) handle(event);
    for (const event of parser.flush()) handle(event);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return result.done !== null && result.done.length > 0 ? result.done : result.accumulated;
}

/** `stream=true` を知らない上流（400 など）か。控えではなく、stream 無しのやり直しで確かめる。 */
function isStreamRejection(result: AttemptResult): boolean {
  if (result.ok) return false;
  if (result.status !== 400 && result.status !== 415 && result.status !== 422) return false;
  return result.kind === "audio" || result.kind === "other";
}

/** `stream` 無しの 1 回。従来の JSON の読み方。 */
async function attemptJson(
  apiKey: string,
  model: string,
  input: TranscriptionInput,
  prompt: string,
  keywords: readonly string[],
): Promise<AttemptResult> {
  const { response, dispose } = await postTranscription(
    apiKey,
    buildForm(model, input, prompt, keywords, false),
    input.signal,
  );
  try {
    if (!response.ok) {
      const body = await readUpstreamError(response);
      const kind = classifyUpstream(response.status, body);
      logUpstreamFailure(model, response.status, body, kind);
      return { ok: false, kind, status: response.status };
    }
    const payload = (await response.json().catch(() => null)) as { text?: unknown } | null;
    return {
      ok: true,
      text: typeof payload?.text === "string" ? payload.text : "",
      model,
    };
  } finally {
    dispose();
  }
}

/** `stream=true` の 1 回。最初の delta まで 10 秒、以降は delta 間 15 秒で打ち切る。 */
async function attemptStream(
  apiKey: string,
  model: string,
  input: TranscriptionInput,
  prompt: string,
  keywords: readonly string[],
): Promise<AttemptResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = (ms: number): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), ms);
  };
  const onClientAbort = (): void => controller.abort();
  input.signal?.addEventListener("abort", onClientAbort, { once: true });
  arm(FIRST_DELTA_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildForm(model, input, prompt, keywords, true),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await readUpstreamError(response);
      const kind = classifyUpstream(response.status, body);
      logUpstreamFailure(model, response.status, body, kind);
      return { ok: false, kind, status: response.status };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    // 上流がストリームを返さない（実装差・プロキシ）なら、JSON として読む。
    if (!contentType.includes("text/event-stream") || !response.body) {
      const payload = (await response.json().catch(() => null)) as { text?: unknown } | null;
      return {
        ok: true,
        text: typeof payload?.text === "string" ? payload.text : "",
        model,
      };
    }

    const text = await readUpstreamStream(
      response.body,
      (delta) => input.onDelta?.(delta),
      () => arm(DELTA_TIMEOUT_MS),
    );
    return { ok: true, text, model };
  } catch (error) {
    // 上流が返した `event: error` は、そのまま利用者向けの失敗として通す。
    if (error instanceof ProblemDetailException) throw error;
    // 25 秒・最初の delta 10 秒・delta 間 15 秒の打ち切りも、通信の失敗として扱う。
    throw networkFailure();
  } finally {
    if (timer !== null) clearTimeout(timer);
    input.signal?.removeEventListener("abort", onClientAbort);
  }
}

/**
 * 1 つのモデルで試す。途中経過が要るときだけ `stream=true` を送り、
 * 上流が `stream` を知らなければ、同じリクエストを stream 無しで 1 度だけやり直す。
 */
async function attemptModel(
  apiKey: string,
  model: string,
  input: TranscriptionInput,
  prompt: string,
  keywords: readonly string[],
): Promise<AttemptResult> {
  if (!input.onDelta) return attemptJson(apiKey, model, input, prompt, keywords);

  const streamed = await attemptStream(apiKey, model, input, prompt, keywords);
  if (streamed.ok || !isStreamRejection(streamed)) return streamed;

  return attemptJson(apiKey, model, input, prompt, keywords);
}

function emptyTranscript(): ProblemDetailException {
  return new ProblemDetailException({
    status: 422,
    title: "Validation Error",
    detail: "聞き取れませんでした。もう一度話すか、手で入力してください。",
    error: "TRANSCRIBE_EMPTY",
  });
}

/**
 * 音声を文字にする。`field` は語彙を絞るヒントにだけ使い、認識結果の解釈は呼び出し側が行う。
 *
 * `prompt` は短い文脈だけにし、語彙は `keywords` へ分ける。モデルの系統で送るパラメータを
 * 出し分け、`gpt-transcribe` が使えないときは控えのモデルで 1 度だけ試す。
 * `onDelta` を渡すと上流をストリーミングで読み、途中経過を順に返す。
 */
export async function transcribeDetailed(
  input: TranscriptionInput,
): Promise<VoiceTranscriptionResult> {
  // モックは鍵より先に見る。鍵が空でも画面の流れを試せるようにするため。
  if (isVoiceMockEnabled()) {
    const text = mockTranscript(input.field);
    // 入力例を 1 度だけ delta で流す。画面の流れ（確認へ進む）は変えない。
    input.onDelta?.(text);
    return { text, model: "mock" };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw unavailable(
      "音声入力は現在利用できません（OPENAI_API_KEY が未設定です）。手で入力してください。",
    );
  }

  // 欄・行・入力済みの値から、短い文脈と語彙を組み立てる。自由文はそのまま連結しない。
  const prompt = buildVoicePrompt({
    field: input.field,
    row: input.row,
    title: input.title,
    venueName: input.venueName,
  });
  const field = input.field ? voiceFieldByKey(input.field) : null;
  const keywords = buildVoiceKeywords(field, {
    title: input.title,
    venueName: input.venueName,
  });

  const model = voiceModel();
  let result = await attemptModel(apiKey, model, input, prompt, keywords);

  // モデルが無い・使えないだけなら、控えのモデルで 1 度だけ試す。
  // 控えは旧系統のことが多いため、語彙は渡さず `language` だけで送る。
  if (!result.ok && result.kind === "model") {
    const fallback = voiceFallbackModel();
    if (fallback && fallback !== model) {
      result = await attemptModel(apiKey, fallback, input, prompt, []);
    }
  }
  if (!result.ok) throw upstreamFailure(result.kind);

  // 句点は画面の確認文にそのまま出る。末尾の句読点だけを落としてから返す。
  const text = cleanTranscript(result.text);
  if (!text) throw emptyTranscript();
  return { text, model: result.model };
}

/**
 * 文字だけを返す従来の入口。使ったモデル名が要る route は `transcribeDetailed` を呼ぶ。
 * 呼び出し元（テスト・文書）を壊さないため、シグネチャは変えない。
 */
export async function transcribeWithOpenAi(input: TranscriptionInput): Promise<string> {
  const { text } = await transcribeDetailed(input);
  return text;
}
