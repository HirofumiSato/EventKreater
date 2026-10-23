import { voiceFieldByKey } from "@/modules/events/lib/voice/fields";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

/**
 * 課金せずに音声入力の画面を試すためのモック。
 *
 * `VOICE_TRANSCRIBE_MOCK=1` のときだけ有効。本番で誤って有効にならないよう、
 * `NODE_ENV=production` では常に無効にする（`next build` と `next start` が該当する）。
 * 差し替えるのは認識の問い合わせだけなので、録音とマイクの許可はそのまま要る。
 */

/** 欄が決まらないときの戻り値。`parse` が読める文字にしておく。 */
const FALLBACK_TEXT = "テスト";

export function isVoiceMockEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.VOICE_TRANSCRIBE_MOCK?.trim() === "1";
}

/**
 * 欄の入力例をそのまま認識結果として返す。
 * 入力例は `parse` が読める形で書いてあるため、聞き直しにならず次の欄へ進める。
 */
export function mockTranscript(field: VoiceFieldKey | null): string {
  if (!field) return FALLBACK_TEXT;
  return voiceFieldByKey(field)?.example ?? FALLBACK_TEXT;
}

/** 一度だけ出すための印。ホットリロードでモジュールが読み直されると再び出る。 */
let warned = false;

/**
 * 起動時に 1 度だけ、いまの設定をログに出す。
 *
 * モックの付け忘れ（鍵が無いのに 503）と、切り忘れ（鍵を入れたのに実 API を呼ばない）の
 * 両方に気づけるようにする。本番ではモックが無効なので、開発のときだけ出す。
 */
export function warnVoiceConfigurationOnce(): void {
  if (warned) return;
  warned = true;
  if (process.env.NODE_ENV === "production") return;

  if (isVoiceMockEnabled()) {
    console.warn(
      "[voice] モックが有効です（VOICE_TRANSCRIBE_MOCK=1）。OpenAI へは送らず、欄の入力例を返します。",
    );
    return;
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.warn(
      "[voice] OPENAI_API_KEY が未設定です。音声入力を送ると 503（TRANSCRIBE_DISABLED）になります。",
    );
  }
}
