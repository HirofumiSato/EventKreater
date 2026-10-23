import { readProblem } from "@/lib/problem";
import { extensionForMimeType, MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

export interface TranscribeResult {
  text: string;
}

/**
 * 録音した音声をサーバーへ送り、文字にする。
 * 音声は保存せず、認識のためだけに OpenAI へ中継する。
 */
export async function transcribeVoiceClip(input: {
  blob: Blob;
  field: VoiceFieldKey | null;
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

  const response = await fetch("/api/v1/voice/transcriptions", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await readProblem(response));
  }
  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string") {
    throw new Error("音声を文字にできませんでした。もう一度話してください。");
  }
  return { text: body.text };
}
