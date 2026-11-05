/**
 * 録音した音声を、認識サービスへ渡せる形にする純ロジック。
 * DOM も Next も使わない（Float32Array とバイト列だけで完結する）。
 *
 * 送る形は 16kHz / 16bit / mono の WAV にする。
 * - 多くの ASR は内部で 16kHz へ落としてから認識するため、48kHz のまま送っても
 *   精度は上がらず、通信量と待ち時間だけが増える。
 * - opus などで圧縮すると、短い数字・固有名詞・息継ぎの子音が落ちやすい。
 *   60 秒でも 16kHz/16bit/mono なら約 1.9MB で、既存の 5MB 上限に収まる。
 */

/** WAV ヘッダの長さ。RIFF 12 + fmt 24 + data 8。 */
const WAV_HEADER_BYTES = 44;

/**
 * 複数チャンネルを 1 本へ混ぜる。各サンプルの平均を取る。
 * チャンネル数が 1 本ならコピーせずそのまま返す（呼び出し側は書き換えないこと）。
 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  // 長さが揃わない入力でも落ちないよう、いちばん短いチャンネルに合わせる。
  let length = channels[0].length;
  for (const channel of channels) length = Math.min(length, channel.length);

  const mono = new Float32Array(length);
  const scale = 1 / channels.length;
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index];
    mono[index] = sum * scale;
  }
  return mono;
}

/**
 * サンプリング周波数を線形補間で変換する。
 *
 * 16kHz へ落とす用途では、遮断フィルタを入れない素朴な間引きでも実用になる。
 * 同じレートならコピーせず同じ配列を返す（呼び出し側は書き換えないこと）。
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) {
    throw new RangeError("サンプリング周波数は正の値で指定してください");
  }
  if (input.length === 0 || fromRate === toRate) return input;

  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const step = fromRate / toRate;
  const last = input.length - 1;
  const output = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    const position = index * step;
    const lower = Math.min(Math.floor(position), last);
    const upper = Math.min(lower + 1, last);
    const fraction = position - lower;
    output[index] = input[lower] + (input[upper] - input[lower]) * fraction;
  }
  return output;
}

/** WAV のヘッダに ASCII を書く（"RIFF" など）。 */
function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/**
 * Float32 のサンプルを 16bit PCM の WAV（mono・リトルエンディアン）へ符号化する。
 * `-1..1` の外は端に丸める。無音は 0、最大は 32767、最小は -32768。
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("サンプリング周波数は正の値で指定してください");
  }

  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, "RIFF");
  // RIFF チャンクの長さは、それ自身の 8 バイトを除いた残り全部。
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt チャンクの長さ
  view.setUint16(20, 1, true); // 1 = PCM（非圧縮）
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 1 秒あたりのバイト数（mono × 2 バイト）
  view.setUint16(32, 2, true); // 1 サンプルあたりのバイト数
  view.setUint16(34, 16, true); // 1 サンプルあたりのビット数

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    // NaN が混ざっても WAV を壊さないよう、無音として扱う。
    const clamped = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    // 負側は 32768 段、正側は 32767 段。端の値をそのまま使い切る。
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(WAV_HEADER_BYTES + index * 2, Math.round(value), true);
  }

  return bytes;
}

/**
 * 指定した秒数の WAV が何バイトになるかの見積もり。
 * 送信前の容量判定に使い、実際の符号化より小さく見積もらないよう切り上げる。
 */
export function wavBytesForSeconds(seconds: number, sampleRate: number): number {
  if (!(seconds > 0)) return WAV_HEADER_BYTES;
  return WAV_HEADER_BYTES + Math.ceil(seconds * sampleRate) * 2;
}
