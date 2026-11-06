import { describe, expect, it } from "vitest";
import {
  FIELD_ANCHOR_RATIO,
  PANEL_GAP,
  fieldScrollDelta,
  panelBoxFor,
} from "@/modules/events/lib/voice/panel";

/** 入力欄 1 行ぶんの矩形。単一行の input の実測に近い値。 */
function fieldRect(overrides: Partial<Parameters<typeof panelBoxFor>[0]> = {}) {
  return { top: 100, left: 16, width: 240, height: 40, ...overrides };
}

describe("音声パネルの置き場所", () => {
  it("パネルは欄のすぐ下に置く", () => {
    const box = panelBoxFor(fieldRect({ top: 120, height: 44 }));
    expect(box.top).toBe(120 + 44 + PANEL_GAP);
  });

  it("左端は欄の左に合わせ、画面の外へはみ出すときは 0 に寄せる", () => {
    expect(panelBoxFor(fieldRect({ left: 32 })).left).toBe(32);
    // 欄が画面の左にはみ出していても、パネルは 0 より左へ出さない。
    expect(panelBoxFor(fieldRect({ left: -24 })).left).toBe(0);
  });

  it("マイクのボタンが右にあるときは、その手前で止めて幅を詰める", () => {
    // 欄の右端は 256 だが、ボタンの左端 200 の手前（8px）で止める。
    const box = panelBoxFor(fieldRect(), 200);
    expect(box.left).toBe(16);
    expect(box.width).toBe(200 - PANEL_GAP - 16);
  });

  it("ボタンの位置を渡さなければ、欄の幅をそのまま使う", () => {
    expect(panelBoxFor(fieldRect()).width).toBe(240);
  });

  it("ボタンが欄の右より十分右にあるときも、欄の幅をそのまま使う", () => {
    expect(panelBoxFor(fieldRect(), 1000).width).toBe(240);
  });

  it("欄がボタンに重なるほど広いときも、幅は負にしない", () => {
    // ボタンが欄の左端より左にある。右端が左端を追い越す。
    const box = panelBoxFor(fieldRect({ left: 40 }), 20);
    expect(box.left).toBe(40);
    expect(box.width).toBe(0);
  });

  it("余白は第 3 引数で差し替えられる", () => {
    const box = panelBoxFor(fieldRect(), 200, 24);
    expect(box.top).toBe(100 + 40 + 24);
    expect(box.width).toBe(200 - 24 - 16);
  });
});

describe("欄を画面の上寄りへ寄せる量", () => {
  it("欄の中心を画面の高さの 35% へ置く", () => {
    // 800px の画面なら基準は 280px。中心が 320px にある欄は 40px 下へ送る。
    expect(FIELD_ANCHOR_RATIO).toBe(0.35);
    expect(fieldScrollDelta({ top: 300, height: 40 }, 800)).toBe(40);
  });

  it("基準の割合は第 3 引数で差し替えられる", () => {
    // 中央（0.5）に置くと 400px が基準になり、同じ欄は 80px 上へ戻す。
    expect(fieldScrollDelta({ top: 300, height: 40 }, 800, 0.5)).toBe(-80);
  });

  it("画面の下端寄りの欄は、下へ送る量が正になる", () => {
    const delta = fieldScrollDelta({ top: 700, height: 40 }, 800);
    expect(delta).toBeGreaterThan(0);
  });

  it("画面の上へはみ出した欄も、送ったあとの中心は画面の内側に残る", () => {
    // 負の量（上へ戻す）を 0 で止めると、はみ出した欄が画面の外に残る。
    const rect = { top: -120, height: 40 };
    const delta = fieldScrollDelta(rect, 800);
    const centerAfter = rect.top + rect.height / 2 - delta;
    expect(delta).toBeLessThan(0);
    expect(centerAfter).toBe(800 * FIELD_ANCHOR_RATIO);
    expect(centerAfter).toBeGreaterThan(0);
  });
});
