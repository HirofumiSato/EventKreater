import { describe, expect, it } from "vitest";
import {
  SPOTLIGHT_HEIGHT,
  SPOTLIGHT_PADDING,
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

  it("くり抜きは外周を時計回り、穴を反時計回りに描く", () => {
    const clip = spotlightClipPath({ top: 100, left: 10, width: 200, height: SPOTLIGHT_HEIGHT });
    expect(clip.startsWith("polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ")).toBe(true);
    expect(clip).toContain("10px 100px, 10px 164px, 210px 164px, 210px 100px, 10px 100px)");
  });
});
