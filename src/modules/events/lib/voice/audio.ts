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

/**
 * pre-roll の長さ。
 *
 * 録音の開始は「録音中の印」が出た瞬間だが、話し始めはその少し前になる。
 * 押してから話し始めるまでの 400ms を捨てずに先頭へ足すため、常に直近 400ms を控えておく。
 */
export const PRE_ROLL_MS = 400;

/** 送る PCM のサンプリング周波数。多くの ASR が内部で 16kHz へ落とすため、最初から合わせる。 */
export const PCM_SAMPLE_RATE = 16_000;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

/**
 * この環境の `AudioContext`。Safari の旧名（`webkitAudioContext`）も見る。
 * 無ければ null（＝PCM では録れない）。
 */
export function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  // `AudioContext` は Window のプロパティではなくグローバルの変数として宣言される。
  if (typeof AudioContext !== "undefined") return AudioContext;
  const scope = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return scope.webkitAudioContext ?? null;
}

/** 16kHz の PCM を AudioWorklet で拾えるか。だめなら MediaRecorder へ落とす。 */
export function isPcmCaptureSupported(): boolean {
  return audioContextConstructor() !== null && typeof AudioWorkletNode !== "undefined";
}

/** 連続した区間を 1 本の `Float32Array` へつなぐ。 */
export function concatSamples(parts: readonly Float32Array[]): Float32Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const merged = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

/** 末尾から `count` サンプルだけを取り出す（pre-roll の切り出し）。 */
export function tailSamples(parts: readonly Float32Array[], count: number): Float32Array {
  if (count <= 0 || parts.length === 0) return new Float32Array(0);
  let total = 0;
  for (const part of parts) total += part.length;
  if (total <= count) return concatSamples(parts);

  const tail = new Float32Array(count);
  let offset = count;
  for (let index = parts.length - 1; index >= 0 && offset > 0; index -= 1) {
    const part = parts[index];
    const take = Math.min(part.length, offset);
    offset -= take;
    tail.set(part.subarray(part.length - take), offset);
  }
  return tail;
}
