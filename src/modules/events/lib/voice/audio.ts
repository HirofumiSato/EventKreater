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

/* ------------------------------------------------------------------------- *
 * 録音中の区切り
 *
 * 録音をそのまま 60 秒送ると、話し終えてから最初の文字が出るまで待たされる。
 * 20ms ごとの RMS だけを見て息継ぎで区切り、区間ごとに文字起こしを送る。
 * ここは DOM を読まない（Float32Array の計算だけ）ので、試験では合成した波で確かめる。
 * ------------------------------------------------------------------------- */

/**
 * これ未満の区間は送らない。
 * 2.5 秒あると日本語の 1 文（「12月5日の18時から渋谷ホールで忘年会をやります」）が入る。
 * これより短い区間は認識が不安定で、送る回数と課金だけが増える。
 */
export const SEGMENT_MIN_MS = 2_500;

/**
 * 無音が来なくても必ず切る長さ。
 * 長く黙り込む人や、息継ぎが拾えない静かな環境でも、表示が 6 秒より遅れないようにする。
 */
export const SEGMENT_MAX_MS = 6_000;

/**
 * この長さだけ静かなら息継ぎとみなす。
 * 日本語の文中の間は 200〜400ms 程度なので、300ms を置くと語の途中では切れない。
 */
export const SILENCE_MS = 300;

/**
 * 無音とみなす RMS。
 * マイクは小さい環境音を拾うため 0 にはしない。話し声は RMS 0.05 前後なので、
 * その 5 分の 1 ほど小さい 0.01 を境にする。実際の値は実機の録音で決める。
 */
export const SILENCE_RMS = 0.01;

/**
 * 区間の末尾に残す重なり。
 * 子音や語尾が区切りの側に落ちても、次の区間の先頭で同じ音を拾えるようにする。
 * 文字にすると同じ語が 2 回出るため、表示では `mergeSegmentText` で 1 つ落とす。
 */
export const SEGMENT_OVERLAP_MS = 200;

/**
 * RMS を見る刻み。音声の 1 フレームは 10〜30ms なので、その真ん中の 20ms に合わせる。
 * 短くすると計算が増え、長くすると息継ぎの終わりを取りこぼす。
 */
export const FRAME_MS = 20;

/** 波形の実効値。区間の大小を振幅の平均ではなくエネルギーで比べるために使う。 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

/** 区間の全体が無音か。区間の途中に話し声が少しでもあれば、送る価値があるので残す。 */
export function isSilentSegment(samples: Float32Array): boolean {
  return rms(samples) < SILENCE_RMS;
}

/**
 * 前の区間の末尾と次の区間の先頭で重なった文字を 1 つだけ落としてつなぐ。
 *
 * 区間は語の切れ目を落とさないために 200ms 重ねてある。そのままつなぐと
 * 「忘年忘年会」のように同じ語が 2 回出るため、最長の一致だけを取り除く。
 * 一致が 1 文字のときは偶然の重なり（「あ」＋「あ…」）が多いので落とさない。
 */
export function mergeSegmentText(previous: string, next: string): string {
  if (previous === "") return next;
  if (next === "") return previous;

  const head = Array.from(previous);
  const tail = Array.from(next);
  const limit = Math.min(head.length, tail.length);
  for (let length = limit; length >= 2; length -= 1) {
    // 前の末尾 `length` 文字と、次の先頭 `length` 文字が同じかを比べる。
    const shared = tail.slice(0, length).join("");
    if (head.slice(head.length - length).join("") === shared) {
      // 落とすのは重なった先頭だけで、残りはそのまま次へ続ける。
      return previous + tail.slice(length).join("");
    }
  }
  return previous + next;
}

/**
 * 区間を切り出す。`push` に届いた順にサンプルをため、息継ぎ（無音）か
 * `SEGMENT_MAX_MS` のどちらかで区切って返す。`flush` は録音を止めたときに残りを返す。
 */
export function createSegmenter(sampleRate: number): {
  push(samples: Float32Array): Float32Array[];
  flush(): Float32Array | null;
} {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("サンプリング周波数は正の値で指定してください");
  }

  const frameSamples = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const minSamples = Math.round((sampleRate * SEGMENT_MIN_MS) / 1000);
  const maxSamples = Math.round((sampleRate * SEGMENT_MAX_MS) / 1000);
  // 300ms を 20ms で割った 15 フレーム。端数は切り上げ、短い無音で切らない側に倒す。
  const silenceFrames = Math.max(1, Math.ceil(SILENCE_MS / FRAME_MS));
  const overlapSamples = Math.round((sampleRate * SEGMENT_OVERLAP_MS) / 1000);

  // 区間の切り出しは 2.5 秒に 1 回なので、伸縮する 1 本の配列で足りる。
  // `copyWithin` で重なりだけを先頭へ戻し、余計な複製を作らない。
  let buffer = new Float32Array(0);
  let length = 0;
  // 20ms の枠として読み終えた位置。`length - processed` がまだ 1 枠に満たない残り。
  let processed = 0;
  // 直近で連続している無音の枠数。話し声の枠が来たら 0 に戻す。
  let silentFramesRun = 0;

  function reserve(extra: number): void {
    if (length + extra <= buffer.length) return;
    let capacity = buffer.length === 0 ? 4096 : buffer.length * 2;
    while (capacity < length + extra) capacity *= 2;
    const grown = new Float32Array(capacity);
    grown.set(buffer.subarray(0, length));
    buffer = grown;
  }

  function push(samples: Float32Array): Float32Array[] {
    const segments: Float32Array[] = [];
    if (samples.length > 0) {
      reserve(samples.length);
      buffer.set(samples, length);
      length += samples.length;
    }

    while (length - processed >= frameSamples) {
      let sum = 0;
      const frameEnd = processed + frameSamples;
      for (let index = processed; index < frameEnd; index += 1) {
        sum += buffer[index] * buffer[index];
      }
      const silent = Math.sqrt(sum / frameSamples) < SILENCE_RMS;
      silentFramesRun = silent ? silentFramesRun + 1 : 0;
      processed = frameEnd;

      const reachedMax = processed >= maxSamples;
      const pausedEnough =
        processed >= minSamples && silentFramesRun >= silenceFrames;
      if (!reachedMax && !pausedEnough) continue;

      const segment = buffer.slice(0, processed);
      // 次の区間は末尾 200ms を先頭に持つ。語の切れ目を落とさないための重なり。
      const keepFrom = Math.max(0, processed - overlapSamples);
      const keep = length - keepFrom;
      buffer.copyWithin(0, keepFrom, length);
      length = keep;
      processed = 0;
      silentFramesRun = 0;

      // 黙っていただけの区間は送らない。文字起こしが幻聴を返す元になる。
      if (!isSilentSegment(segment)) segments.push(segment);
    }

    return segments;
  }

  function flush(): Float32Array | null {
    if (length === 0) return null;
    const rest = buffer.slice(0, length);
    length = 0;
    processed = 0;
    silentFramesRun = 0;
    return isSilentSegment(rest) ? null : rest;
  }

  return { push, flush };
}
