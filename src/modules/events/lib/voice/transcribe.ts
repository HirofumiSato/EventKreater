import { readProblem } from "@/lib/problem";
import { extensionForMimeType, MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

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

/**
 * 録音した音声をサーバーへ送り、文字にする。
 * 音声は保存せず、認識のためだけに OpenAI へ中継する。
 */
export async function transcribeVoiceClip(input: {
  blob: Blob;
  field: VoiceFieldKey | null;
  /** 欄の文脈。当て字の手掛かりで、無くても認識は動く。 */
  context?: VoiceTranscribeContext;
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
