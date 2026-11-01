import { describe, expect, it } from "vitest";
import {
  clampOffset,
  coverScale,
  cropSourceRect,
  isCropLargeEnough,
  MAX_ZOOM,
  maxZoomForMinCrop,
  MIN_HEADER_CROP_WIDTH,
  MIN_ZOOM,
  zoomAroundCenter,
} from "@/modules/organizers/lib/crop";

/** 試験で使う 3:1 の枠。実物と同じ縦横比で、計算を読みやすくする。 */
const FRAME_W = 300;
const FRAME_H = 100;

describe("coverScale", () => {
  it("横長の画像は高さで合わせる", () => {
    // 2000x1000 を 300x100 に敷くと、高さ基準の 0.1 では幅が 200 しかない。幅基準の 0.15 を採る。
    expect(coverScale(2000, 1000, FRAME_W, FRAME_H)).toBeCloseTo(0.15);
  });

  it("縦長の画像は幅で合わせる", () => {
    expect(coverScale(1000, 3000, FRAME_W, FRAME_H)).toBeCloseTo(0.3);
  });

  it("3:1 の画像は拡大後の大きさが枠と一致する", () => {
    const scale = coverScale(3000, 1000, FRAME_W, FRAME_H);

    expect(3000 * scale).toBeCloseTo(FRAME_W);
    expect(1000 * scale).toBeCloseTo(FRAME_H);
  });

  it("枠と同じ大きさなら等倍", () => {
    expect(coverScale(FRAME_W, FRAME_H, FRAME_W, FRAME_H)).toBe(1);
  });

  it("拡大後の画像は縦横とも枠を覆う", () => {
    const sizes = [
      [4000, 1000],
      [1000, 4000],
      [1600, 1000],
      [1920, 640],
    ];

    for (const [naturalW, naturalH] of sizes) {
      const scale = coverScale(naturalW, naturalH, FRAME_W, FRAME_H);

      expect(naturalW * scale).toBeGreaterThanOrEqual(FRAME_W);
      expect(naturalH * scale).toBeGreaterThanOrEqual(FRAME_H);
    }
  });
});

describe("clampOffset", () => {
  it("範囲内はずらしたまま返す", () => {
    expect(clampOffset(100, 800, 300)).toBe(100);
    expect(clampOffset(-100, 800, 300)).toBe(-100);
  });

  it("行き過ぎた分は端で止める", () => {
    // はみ出しは 800 - 300 = 500。片側 250 まで動かせる。
    expect(clampOffset(1000, 800, 300)).toBe(250);
    expect(clampOffset(-1000, 800, 300)).toBe(-250);
  });

  it("拡大後の大きさが枠と同じ軸は必ず 0", () => {
    expect(clampOffset(120, 300, 300)).toBe(0);
    expect(clampOffset(-500, 300, 300)).toBe(0);
  });

  it("枠より小さいときも 0", () => {
    expect(clampOffset(40, 200, 300)).toBe(0);
  });
});

describe("zoomAroundCenter", () => {
  const geometry = { naturalW: 4000, naturalH: 1000, frameW: FRAME_W, frameH: FRAME_H };

  it("枠の中心にある画素は動かさない", () => {
    // 1 倍で右へ 30px ずらした状態から 2 倍にする。中心を保つので、ずらし幅も 2 倍になる。
    const before = cropSourceRect({ ...geometry, zoom: 1, offsetX: 30, offsetY: 0 });
    const offsets = zoomAroundCenter({ ...geometry, fromZoom: 1, toZoom: 2, offsetX: 30, offsetY: 0 });
    const after = cropSourceRect({ ...geometry, zoom: 2, ...offsets });

    expect(offsets.offsetX).toBeCloseTo(60);
    expect(before.x + before.width / 2).toBeCloseTo(after.x + after.width / 2, 5);
    expect(before.y + before.height / 2).toBeCloseTo(after.y + after.height / 2, 5);
  });

  it("縮めるときは端で止める", () => {
    // 3 倍では片側 450px まで動かせるが、1 倍では 50px までしか動かせない。
    const offsets = zoomAroundCenter({ ...geometry, fromZoom: 3, toZoom: 1, offsetX: 450, offsetY: 0 });

    expect(offsets.offsetX).toBe(50);
  });

  it("同じ倍率ならずらし幅は変わらない", () => {
    const offsets = zoomAroundCenter({ ...geometry, fromZoom: 2, toZoom: 2, offsetX: 30, offsetY: 0 });

    expect(offsets.offsetX).toBe(30);
    expect(offsets.offsetY).toBe(0);
  });
});

describe("cropSourceRect", () => {
  const geometry = { naturalW: 4000, naturalH: 1000, frameW: FRAME_W, frameH: FRAME_H };

  it("中央・1 倍では元画像の真ん中を 3:1 で切り出す", () => {
    expect(cropSourceRect({ ...geometry, zoom: 1, offsetX: 0, offsetY: 0 })).toEqual({
      x: 500,
      y: 0,
      width: 3000,
      height: 1000,
    });
  });

  it("画像を左へずらすと右端まで使う", () => {
    const rect = cropSourceRect({ ...geometry, zoom: 1, offsetX: -50, offsetY: 0 });

    expect(rect.x).toBe(1000);
    expect(rect.x + rect.width).toBe(geometry.naturalW);
  });

  it("整数だけを返す", () => {
    const rect = cropSourceRect({ ...geometry, zoom: 1.7, offsetX: 13.5, offsetY: -7.25 });

    for (const value of [rect.x, rect.y, rect.width, rect.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("どの倍率・ずらし幅でも元画像の外へ出ない", () => {
    const offsets = [-10000, -50, 0, 25, 10000];

    for (const zoom of [MIN_ZOOM, 2, MAX_ZOOM]) {
      for (const offsetX of offsets) {
        for (const offsetY of offsets) {
          const rect = cropSourceRect({ ...geometry, zoom, offsetX, offsetY });

          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(geometry.naturalW);
          expect(rect.y + rect.height).toBeLessThanOrEqual(geometry.naturalH);
        }
      }
    }
  });

  it("非常に小さな画像でも幅・高さは 0 にしない", () => {
    const rect = cropSourceRect({
      naturalW: 3,
      naturalH: 1,
      frameW: FRAME_W,
      frameH: FRAME_H,
      zoom: MAX_ZOOM,
      offsetX: 0,
      offsetY: 0,
    });

    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
  });

  it("倍率を上げると切り出しは狭くなる", () => {
    const atOne = cropSourceRect({ ...geometry, zoom: 1, offsetX: 0, offsetY: 0 });
    const atTwo = cropSourceRect({ ...geometry, zoom: 2, offsetX: 0, offsetY: 0 });

    expect(atTwo.width).toBeLessThan(atOne.width);
    expect(atTwo.height).toBeLessThan(atOne.height);
  });
});

describe("maxZoomForMinCrop と isCropLargeEnough", () => {
  const geometry = { naturalW: 1600, naturalH: 1000, frameW: FRAME_W, frameH: FRAME_H };

  it("最小幅ちょうどになる倍率を返す", () => {
    // cover は 300 / 1600 = 0.1875。800 / 3000 = 0.1875 × 2 なので、2 倍が上限。
    expect(maxZoomForMinCrop(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H)).toBeCloseTo(2);
  });

  it("上限の倍率では足りていて、少し上げると足りない", () => {
    const max = maxZoomForMinCrop(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H);

    expect(isCropLargeEnough(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H, max)).toBe(true);
    expect(isCropLargeEnough(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H, max + 0.1)).toBe(false);
  });

  it("元画像が小さすぎるときは 1 を返し、1 倍でも足りないと分かる", () => {
    const max = maxZoomForMinCrop(400, 1000, FRAME_W, FRAME_H);

    expect(max).toBe(MIN_ZOOM);
    expect(isCropLargeEnough(400, 1000, FRAME_W, FRAME_H, max)).toBe(false);
  });

  it("3 倍でも足りる画像は 3 より大きい値を返し、画面側は上限で切る", () => {
    const max = maxZoomForMinCrop(8000, 2000, FRAME_W, FRAME_H);

    expect(max).toBeGreaterThan(MAX_ZOOM);
    expect(Math.min(MAX_ZOOM, max)).toBe(MAX_ZOOM);
    expect(isCropLargeEnough(8000, 2000, FRAME_W, FRAME_H, MAX_ZOOM)).toBe(true);
  });

  it("最小幅は 800px を既定にする", () => {
    expect(MIN_HEADER_CROP_WIDTH).toBe(800);
    expect(isCropLargeEnough(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H, 2)).toBe(true);
    expect(isCropLargeEnough(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H, 2.5)).toBe(false);
  });

  it("切り出しの実寸でも同じ判定になる", () => {
    const rect = cropSourceRect({ ...geometry, zoom: 2, offsetX: 0, offsetY: 0 });
    const max = maxZoomForMinCrop(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H);

    expect(rect.width).toBeGreaterThanOrEqual(MIN_HEADER_CROP_WIDTH);
    expect(isCropLargeEnough(geometry.naturalW, geometry.naturalH, FRAME_W, FRAME_H, max)).toBe(true);
  });
});
