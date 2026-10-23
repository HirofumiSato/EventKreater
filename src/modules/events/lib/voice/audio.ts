/** ブラウザの録音形式を選ぶ。Safari は webm を作れず mp4（AAC）になる。 */

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** 録音の上限。超えたら自動で止める。API の上限とは別に、画面側でも止める。 */
export const MAX_RECORDING_MS = 60_000;

/** 送る音声の上限。サーバーの検証と同じ値にする。 */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

/** この端末で作れる音声の MIME。どれも作れなければ null。 */
export function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  // 指定なしでも録音自体はできる。形式はブラウザの既定に任せる。
  return "";
}

/** ファイル名の拡張子。OpenAI は拡張子で形式を見るため、MIME と揃える。 */
export function extensionForMimeType(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}
