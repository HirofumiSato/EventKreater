import { describe, expect, it } from "vitest";
import {
  downmixToMono,
  encodeWav,
  resampleLinear,
  wavBytesForSeconds,
} from "@/modules/events/lib/voice/pcm";

/** WAV の先頭から ASCII を読む。 */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe("ステレオからモノラルへ", () => {
  it("チャンネルごとの平均を取る", () => {
    const left = new Float32Array([1, 0, -1]);
    const right = new Float32Array([1, 2, 1]);
    expect(Array.from(downmixToMono([left, right]))).toEqual([1, 1, 0]);
  });

  it("3 チャンネルでも平均する", () => {
    const mono = downmixToMono([
      new Float32Array([0.3]),
      new Float32Array([0.6]),
      new Float32Array([0.9]),
    ]);
    expect(mono[0]).toBeCloseTo(0.6, 6);
  });

  it("長さが揃わないときは短い方に合わせる", () => {
    const mono = downmixToMono([new Float32Array([0.2, 0.4]), new Float32Array([0.4])]);
    expect(mono.length).toBe(1);
    expect(mono[0]).toBeCloseTo(0.3, 6);
  });

  it("チャンネルが 1 本ならそのまま返す", () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(downmixToMono([input])).toBe(input);
  });

  it("チャンネルが無ければ空を返す", () => {
    expect(downmixToMono([]).length).toBe(0);
  });
});

describe("サンプリング周波数の変換", () => {
  it("同じレートなら同じ配列を返す", () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleLinear(input, 16_000, 16_000)).toBe(input);
  });

  it("空の入力はそのまま返す", () => {
    const input = new Float32Array(0);
    expect(resampleLinear(input, 48_000, 16_000)).toBe(input);
  });

  it("48kHz の 1 秒は 16kHz では 16000 サンプルになる", () => {
    const input = new Float32Array(48_000);
    expect(resampleLinear(input, 48_000, 16_000).length).toBe(16_000);
  });

  it("16kHz の 1 秒は 48kHz では 48000 サンプルになる", () => {
    const input = new Float32Array(16_000);
    expect(resampleLinear(input, 16_000, 48_000).length).toBe(48_000);
  });

  it("線形補間で間の値を埋める", () => {
    // 2Hz の [0, 1] を 4Hz へ。位置 0, 0.5, 1, 1.5 を読む。末尾は端で止める。
    const output = resampleLinear(new Float32Array([0, 1]), 2, 4);
    expect(Array.from(output)).toEqual([0, 0.5, 1, 1]);
  });

  it("一定の信号は一定のまま", () => {
    const input = new Float32Array(100).fill(0.25);
    for (const value of resampleLinear(input, 100, 37)) {
      expect(value).toBeCloseTo(0.25, 6);
    }
  });

  it("周波数が 0 以下なら例外にする", () => {
    const input = new Float32Array([0]);
    expect(() => resampleLinear(input, 0, 16_000)).toThrow(RangeError);
    expect(() => resampleLinear(input, 16_000, -1)).toThrow(RangeError);
  });
});

describe("WAV への符号化", () => {
  it("44 バイトのヘッダと 16bit のデータを持つ", () => {
    const bytes = encodeWav(new Float32Array(5), 16_000);
    expect(bytes.length).toBe(44 + 5 * 2);
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(ascii(bytes, 8, 4)).toBe("WAVE");
    expect(ascii(bytes, 12, 4)).toBe("fmt ");
    expect(ascii(bytes, 36, 4)).toBe("data");
  });

  it("ヘッダの各値がリトルエンディアンで入る", () => {
    const bytes = encodeWav(new Float32Array(5), 16_000);
    const view = viewOf(bytes);
    // RIFF チャンクの長さは、44 - 8 + データ長。
    expect(view.getUint32(4, true)).toBe(36 + 5 * 2);
    expect(view.getUint32(16, true)).toBe(16); // fmt の長さ
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000); // サンプリング周波数
    expect(view.getUint32(28, true)).toBe(32_000); // 1 秒あたりのバイト数
    expect(view.getUint16(32, true)).toBe(2); // 1 サンプルあたりのバイト数
    expect(view.getUint16(34, true)).toBe(16); // 1 サンプルあたりのビット数
    expect(view.getUint32(40, true)).toBe(5 * 2); // データ長
  });

  it("無音はすべて 0 になる", () => {
    const bytes = encodeWav(new Float32Array(4), 16_000);
    expect(Array.from(bytes.slice(44))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("振幅を -32768..32767 へ変換する", () => {
    const bytes = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16_000);
    const view = viewOf(bytes);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16_384);
    expect(view.getInt16(48, true)).toBe(-16_384);
    expect(view.getInt16(50, true)).toBe(32_767);
    expect(view.getInt16(52, true)).toBe(-32_768);
  });

  it("範囲外の振幅は端に丸める", () => {
    const bytes = encodeWav(new Float32Array([-2, 2]), 16_000);
    const view = viewOf(bytes);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(32_767);
  });

  it("NaN は無音として扱う", () => {
    const bytes = encodeWav(new Float32Array([Number.NaN]), 16_000);
    expect(viewOf(bytes).getInt16(44, true)).toBe(0);
  });

  it("周波数が 0 以下なら例外にする", () => {
    expect(() => encodeWav(new Float32Array(1), 0)).toThrow(RangeError);
  });
});

describe("容量の見積もり", () => {
  it("60 秒・16kHz は約 1.9MB", () => {
    expect(wavBytesForSeconds(60, 16_000)).toBe(44 + 60 * 16_000 * 2);
  });

  it("1 秒ぶんはヘッダとデータの合計", () => {
    expect(wavBytesForSeconds(1, 16_000)).toBe(44 + 32_000);
  });

  it("0 秒以下はヘッダだけ", () => {
    expect(wavBytesForSeconds(0, 16_000)).toBe(44);
    expect(wavBytesForSeconds(-3, 16_000)).toBe(44);
  });

  it("端数のある秒数は切り上げる", () => {
    // 0.5ms でも 16kHz ではサンプルが 8 個ある。
    expect(wavBytesForSeconds(0.0005, 16_000)).toBe(44 + 8 * 2);
  });
});
