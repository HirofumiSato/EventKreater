import { describe, expect, it } from "vitest";
import {
  circleSpotlightClipPath,
  SPOTLIGHT_CIRCLE_SEGMENTS,
  SPOTLIGHT_HEIGHT,
  SPOTLIGHT_PADDING,
  SPOTLIGHT_RESERVED_GAP,
  spotlightClipPath,
  spotlightFor,
} from "@/modules/events/lib/voice/spotlight";

/** 入力欄 1 行ぶんの矩形。単一行の input/select の実測に近い値。 */
function fieldRect(overrides: Partial<Parameters<typeof spotlightFor>[0]> = {}) {
  return { top: 0, left: 0, width: 200, height: 40, ...overrides };
}

describe("音声モードの覆いの穴", () => {
  it("穴の高さは欄に合わせず、常に固定になる", () => {
    const viewport = 545;
    const short = spotlightFor(fieldRect({ top: 250, height: 32 }), viewport);
    const tall = spotlightFor(fieldRect({ top: 250, height: 120 }), viewport);
    expect(short.height).toBe(SPOTLIGHT_HEIGHT);
    expect(tall.height).toBe(SPOTLIGHT_HEIGHT);
  });

  it("欄が画面の中央にあるとき、穴も中央に置く", () => {
    const viewport = 800;
    // 欄の中央 = 400 = ビューポートの中央。
    const rect = fieldRect({ top: 380, height: 40 });
    const spot = spotlightFor(rect, viewport);
    expect(spot.top).toBe((viewport - SPOTLIGHT_HEIGHT) / 2);
  });

  it("欄が画面の下にはみ出していても、穴は画面の内側に収める", () => {
    // スクロール前の欄。文書上の位置のまま測ると穴が画面外へ出る。
    const viewport = 545;
    const spot = spotlightFor(fieldRect({ top: 748, height: 40 }), viewport);
    expect(spot.top).toBe(viewport - SPOTLIGHT_HEIGHT);
  });

  it("欄が画面の上にはみ出していても、穴は 0 より上へ出さない", () => {
    const spot = spotlightFor(fieldRect({ top: -300, height: 40 }), 545);
    expect(spot.top).toBe(0);
  });

  it("幅と左は欄の実測に余白を足し、左は 0 で止める", () => {
    const spot = spotlightFor(fieldRect({ top: 100, left: 20, width: 200 }), 800);
    expect(spot.left).toBe(20 - SPOTLIGHT_PADDING);
    expect(spot.width).toBe(200 + SPOTLIGHT_PADDING * 2);

    const edge = spotlightFor(fieldRect({ top: 100, left: 2, width: 200 }), 800);
    expect(edge.left).toBe(0);
  });

  it("パネルの上端を渡すと、穴の下端がパネルより上に収まる", () => {
    const viewport = 800;
    const reservedBottom = 500;
    // 欄がパネルより下にあるときも、穴だけをパネルの上へ寄せる。
    const spot = spotlightFor(fieldRect({ top: 700, height: 40 }), viewport, reservedBottom);
    expect(spot.height).toBe(SPOTLIGHT_HEIGHT);
    expect(spot.top + spot.height).toBeLessThanOrEqual(reservedBottom - SPOTLIGHT_RESERVED_GAP);
    expect(spot.top).toBe(reservedBottom - SPOTLIGHT_RESERVED_GAP - SPOTLIGHT_HEIGHT);
  });

  it("パネルの上端を渡さなければ、従来どおり画面の下端まで使う", () => {
    const viewport = 545;
    const spot = spotlightFor(fieldRect({ top: 748, height: 40 }), viewport);
    expect(spot.top).toBe(viewport - SPOTLIGHT_HEIGHT);
  });

  it("パネルが画面の外にあっても、穴は 0 より上へ出さない", () => {
    const spot = spotlightFor(fieldRect({ top: 100, height: 40 }), 800, 0);
    expect(spot.top).toBe(0);
  });

  it("くり抜きは外周を時計回り、穴を反時計回りに描く", () => {
    const clip = spotlightClipPath({ top: 100, left: 10, width: 200, height: SPOTLIGHT_HEIGHT });
    expect(clip.startsWith("polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ")).toBe(true);
    expect(clip).toContain("10px 100px, 10px 164px, 210px 164px, 210px 100px, 10px 100px)");
  });
});

describe("丸い穴", () => {
  // 中心 (228, 128)、半径 28 の正方形。
  const spot = { top: 100, left: 200, width: 56, height: 56 };

  /** くり抜き文字列から、px 指定の点だけを取り出す。 */
  function holePoints(clip: string): number[][] {
    return clip
      .replace(/^polygon\(/, "")
      .replace(/\)$/, "")
      .split(", ")
      .filter((part) => part.includes("px"))
      .map((part) => part.match(/-?\d+(?:\.\d+)?/g)!.map(Number));
  }

  it("外周は矩形のくり抜きと同じ順で覆い、穴だけを多角形で置く", () => {
    const clip = circleSpotlightClipPath(spot);
    expect(clip.startsWith("polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ")).toBe(true);
    expect(clip.endsWith(")")).toBe(true);
  });

  it("穴は矩形の中央を中心にした丸になる", () => {
    const clip = circleSpotlightClipPath(spot);
    expect(clip).toContain("256px 128px"); // 角度 0（右端）
    expect(clip).toContain("200px 128px"); // 真左
    expect(clip).toContain("228px 100px"); // 真上
    expect(clip).toContain("228px 156px"); // 真下
  });

  it("穴の各点は矩形の内側に収まり、はみ出さない", () => {
    const points = holePoints(circleSpotlightClipPath(spot));
    expect(points.length).toBe(SPOTLIGHT_CIRCLE_SEGMENTS + 1); // 閉じる点を含む
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(spot.left - 0.01);
      expect(x).toBeLessThanOrEqual(spot.left + spot.width + 0.01);
      expect(y).toBeGreaterThanOrEqual(spot.top - 0.01);
      expect(y).toBeLessThanOrEqual(spot.top + spot.height + 0.01);
    }
  });

  it("始点から次の点へ上向きに進む（反時計回り）", () => {
    const points = holePoints(circleSpotlightClipPath(spot));
    expect(points[0]).toEqual([256, 128]);
    // 角度 0 の次は角度 -2π/N。中心より上へ動く。
    expect(points[1][1]).toBeLessThan(128);
    expect(points[1][0]).toBeLessThan(256);
  });

  it("頂点数を変えても閉じた多角形のままになる", () => {
    const points = holePoints(circleSpotlightClipPath(spot, 3));
    expect(points.length).toBe(4); // 3 頂点 + 閉じる点
    expect(points[0]).toEqual(points[3]);
  });
});
