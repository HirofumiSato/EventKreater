import { ProblemDetailException } from "@/lib/exceptions";
import { voicePromptFor } from "@/modules/events/lib/voice/fields";
import { isVoiceMockEnabled, mockTranscript } from "@/modules/events/lib/voice/mock";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

/**
 * 音声認識（OpenAI）への問い合わせ。
 * 音声は保存せず、認識結果の文字だけを返す。
 */

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";

/** 既定のモデル。`VOICE_TRANSCRIBE_MODEL` で差し替えられる。 */
export const DEFAULT_VOICE_MODEL = "gpt-4o-mini-transcribe";

export function voiceModel(): string {
  const configured = process.env.VOICE_TRANSCRIBE_MODEL?.trim();
  return configured ? configured : DEFAULT_VOICE_MODEL;
}

/** 鍵が無ければ音声入力は使えない。画面は手入力へ戻る。モックが有効なら鍵は要らない。 */
export function isVoiceTranscriptionConfigured(): boolean {
  return isVoiceMockEnabled() || Boolean(process.env.OPENAI_API_KEY?.trim());
}

interface OpenAiErrorBody {
  error?: { message?: string; type?: string; code?: string };
}

function unavailable(detail: string): ProblemDetailException {
  return new ProblemDetailException({
    status: 503,
    title: "Voice Unavailable",
    detail,
    error: "TRANSCRIBE_DISABLED",
  });
}

function upstreamFailure(status: number): ProblemDetailException {
  if (status === 429) {
    return new ProblemDetailException({
      status: 429,
      title: "Too Many Requests",
      detail: "音声認識が混み合っています。少し待ってからもう一度お試しください。",
      error: "TRANSCRIBE_BUSY",
    });
  }
  if (status === 401 || status === 403) {
    return new ProblemDetailException({
      status: 502,
      title: "Voice Unavailable",
      detail: "音声認識の設定が正しくありません。管理者に連絡してください。",
      error: "TRANSCRIBE_MISCONFIGURED",
    });
  }
  if (status === 400 || status === 413 || status === 415) {
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

/**
 * 音声を文字にする。`field` は語彙を絞るヒントにだけ使い、認識結果の解釈は呼び出し側が行う。
 */
export async function transcribeWithOpenAi(input: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  field: VoiceFieldKey | null;
}): Promise<string> {
  // モックは鍵より先に見る。鍵が空でも画面の流れを試せるようにするため。
  if (isVoiceMockEnabled()) return mockTranscript(input.field);

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw unavailable(
      "音声入力は現在利用できません（OPENAI_API_KEY が未設定です）。手で入力してください。",
    );
  }

  const form = new FormData();
  // Uint8Array の裏の ArrayBuffer は SharedArrayBuffer のこともある。
  // Blob は ArrayBuffer しか受けないため、必要な範囲を切り出して渡す。
  const buffer = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;
  form.append("file", new Blob([buffer], { type: input.contentType }), input.filename);
  form.append("model", voiceModel());
  // gpt-4o-mini-transcribe が受けるのは json と text だけ。verbose_json は送らない。
  form.append("response_format", "json");
  form.append("language", "ja");
  const prompt = voicePromptFor(input.field);
  if (prompt) form.append("prompt", prompt);

  let response: Response;
  try {
    response = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new ProblemDetailException({
      status: 502,
      title: "Voice Unavailable",
      detail: "音声認識に接続できませんでした。通信状況を確認するか、手で入力してください。",
      error: "TRANSCRIBE_FAILED",
    });
  }

  if (!response.ok) {
    // 上流の本文は利用者に見せない（鍵や内部の事情が混ざりうる）。ログにだけ残す。
    const body = (await response.json().catch(() => null)) as OpenAiErrorBody | null;
    if (body?.error?.message) {
      console.warn(`[voice] transcription failed: ${body.error.message}`);
    }
    throw upstreamFailure(response.status);
  }

  const payload = (await response.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new ProblemDetailException({
      status: 422,
      title: "Validation Error",
      detail: "聞き取れませんでした。もう一度話すか、手で入力してください。",
      error: "TRANSCRIBE_EMPTY",
    });
  }
  return text;
}
