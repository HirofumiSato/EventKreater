import { describe, expect, it } from "vitest";
import {
  createSegmenter,
  FRAME_MS,
  isSilentSegment,
  mergeSegmentText,
  rms,
  SEGMENT_MAX_MS,
  SEGMENT_MIN_MS,
  SEGMENT_OVERLAP_MS,
  SILENCE_MS,
  SILENCE_RMS,
} from "@/modules/events/lib/voice/audio";

/** 試験は実際に送る形（16kHz の PCM）に合わせる。 */
const RATE = 16_000;

const msToSamples = (ms: number): number => Math.round((RATE * ms) / 1000);

/** 正弦波。振幅 0.5 の 440Hz は RMS 0.35 ほどで、無音のしきい値より十分大きい。 */
function tone(ms: number, amplitude = 0.5, frequency = 440): Float32Array {
  const samples = new Float32Array(msToSamples(ms));
  const step = (2 * Math.PI * frequency) / RATE;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin(step * index);
  }
  return samples;
}

/** 0 埋めの無音。 */
function silence(ms: number): Float32Array {
  return new Float32Array(msToSamples(ms));
}

function join(...parts: Float32Array[]): Float32Array {
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

describe("区切りの定数", () => {
  it("画面と後続の送信が決めた値を持つ", () => {
    expect(SEGMENT_MIN_MS).toBe(2_500);
    expect(SEGMENT_MAX_MS).toBe(6_000);
    expect(SILENCE_MS).toBe(300);
    expect(SILENCE_RMS).toBe(0.01);
    expect(SEGMENT_OVERLAP_MS).toBe(200);
    expect(FRAME_MS).toBe(20);
  });
});

describe("rms と無音の判定", () => {
  it("無音は 0、一定の振幅はその振幅になる", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5, 6);
  });

  it("空の区間は無音として扱う", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(isSilentSegment(new Float32Array(0))).toBe(true);
  });

  it("しきい値未満だけを無音とする", () => {
    expect(isSilentSegment(new Float32Array(100).fill(SILENCE_RMS * 2))).toBe(false);
    expect(isSilentSegment(new Float32Array(100).fill(SILENCE_RMS / 2))).toBe(true);
    expect(isSilentSegment(tone(500))).toBe(false);
  });
});

describe("録音の区切り", () => {
  it("息継ぎの無音で区切る", () => {
    const segmenter = createSegmenter(RATE);
    const segments = segmenter.push(join(tone(3_000), silence(500)));

    expect(segments).toHaveLength(1);
    // 話し終わり（3 秒）から 300ms の無音がそろった時点で切る。
    expect(segments[0].length).toBe(msToSamples(3_300));
    // 残りは重なりだけで、すべて無音なので最後の区間にはならない。
    expect(segmenter.flush()).toBeNull();
  });

  it("SEGMENT_MIN_MS 未満では切らない", () => {
    const segmenter = createSegmenter(RATE);
    // 2 秒の話 + 400ms の無音 = 2.4 秒。しきい値の 2.5 秒に届かない。
    const segments = segmenter.push(join(tone(2_000), silence(400)));

    expect(segments).toHaveLength(0);
    // 止めたときに 1 つの区間として残る。
    expect(segmenter.flush()?.length).toBe(msToSamples(2_400));
  });

  it("無音が来なくても SEGMENT_MAX_MS で必ず切る", () => {
    const segmenter = createSegmenter(RATE);
    const segments = segmenter.push(tone(7_000));

    expect(segments).toHaveLength(1);
    expect(segments[0].length).toBe(msToSamples(SEGMENT_MAX_MS));
    // 区切りで次の区間へ残した 200ms の重なりを含め、残り 1.2 秒を最後の区間として返す。
    expect(segmenter.flush()?.length).toBe(msToSamples(1_200));
  });

  it("無音だけの区間は返さない", () => {
    const segmenter = createSegmenter(RATE);
    // 6 秒で強制的に切られるが、中身が無音なので送らない。
    expect(segmenter.push(silence(6_500))).toHaveLength(0);
    expect(segmenter.flush()).toBeNull();
  });

  it("話し声の前後に長い無音があっても、無音だけの区間を作らない", () => {
    const segmenter = createSegmenter(RATE);
    // 頭の 4 秒は無音。2.5 秒で切られるが、中身が無音なので捨てる。
    const segments = segmenter.push(join(silence(4_000), tone(3_000), silence(500)));

    expect(segments).toHaveLength(1);
    expect(isSilentSegment(segments[0])).toBe(false);
  });

  it("区間は push が返した順に並び、送った順が入れ替わらない", () => {
    const segmenter = createSegmenter(RATE);
    // 1 回の push で 2 回切れる並び。後半の振幅を大きくして順序を見分ける。
    const segments = segmenter.push(
      join(tone(3_000, 0.5), silence(400), tone(3_000, 0.9), silence(400)),
    );

    expect(segments).toHaveLength(2);
    expect(rms(segments[0])).toBeLessThan(rms(segments[1]));
  });

  it("20ms の枠に満たない端数の push でも区切れる", () => {
    const segmenter = createSegmenter(RATE);
    const all = join(tone(3_000), silence(500));
    const collected: Float32Array[] = [];
    // AudioWorklet は 1 回に 128 サンプル前後を渡す。20ms の枠をまたいでも同じ結果にする。
    for (let offset = 0; offset < all.length; offset += 128) {
      collected.push(...segmenter.push(all.slice(offset, offset + 128)));
    }

    expect(collected).toHaveLength(1);
    expect(collected[0].length).toBe(msToSamples(3_300));
  });

  it("flush は残りのバッファを最後の区間にする", () => {
    const segmenter = createSegmenter(RATE);
    expect(segmenter.push(tone(1_000))).toHaveLength(0);

    const rest = segmenter.flush();
    expect(rest?.length).toBe(msToSamples(1_000));
    // 2 回目は残りが無いので null。
    expect(segmenter.flush()).toBeNull();
  });

  it("空の push は区間も状態も変えない", () => {
    const segmenter = createSegmenter(RATE);
    expect(segmenter.push(new Float32Array(0))).toHaveLength(0);
    expect(segmenter.flush()).toBeNull();
  });

  it("サンプリング周波数が不正なら例外にする", () => {
    expect(() => createSegmenter(0)).toThrow(RangeError);
    expect(() => createSegmenter(Number.NaN)).toThrow(RangeError);
  });
});

describe("区間の文字をつなぐ", () => {
  it("重なった最長一致を 1 つだけ落とす", () => {
    expect(mergeSegmentText("渋谷ホールで忘年", "忘年会を開きます")).toBe(
      "渋谷ホールで忘年会を開きます",
    );
    expect(mergeSegmentText("会場は渋谷ホール", "渋谷ホールで開きます")).toBe(
      "会場は渋谷ホールで開きます",
    );
  });

  it("重なりが無ければそのままつなぐ", () => {
    expect(mergeSegmentText("渋谷ホールで", "忘年会を開きます")).toBe(
      "渋谷ホールで忘年会を開きます",
    );
  });

  it("一致が 1 文字以下なら落とさない", () => {
    expect(mergeSegmentText("あい", "い")).toBe("あいい");
    expect(mergeSegmentText("あ", "あ")).toBe("ああ");
  });

  it("片方が空ならもう片方を返す", () => {
    expect(mergeSegmentText("", "忘年会を開きます")).toBe("忘年会を開きます");
    expect(mergeSegmentText("渋谷ホールで", "")).toBe("渋谷ホールで");
    expect(mergeSegmentText("", "")).toBe("");
  });

  it("同じ文字の繰り返しでも落とすのは 1 回だけ", () => {
    // 前の末尾「ああ」を 1 つ落とす。残りの「あ」と次の「ああ」はそのまま残る。
    expect(mergeSegmentText("あああ", "ああ")).toBe("あああ");
  });
});
