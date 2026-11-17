import { describe, expect, it } from "vitest";
import { REVEAL_MARGIN, revealScrollDelta } from "@/modules/events/lib/reveal";

/** キーボードが出ていない、いちばん普通の画面（390 x 800）。 */
const FULL = { top: 0, height: 800 };

describe("エラーのある欄を画面へ収める", () => {
  it("欄とエラー文が収まっていれば動かさない", () => {
    expect(revealScrollDelta({ top: 300, bottom: 340 }, FULL)).toBe(0);
  });

  it("エラー文がキーボードの裏へ入るときは、その下辺を余白の上へ送る", () => {
    // テンキーで見えている範囲が 400px まで縮んだ状態。
    const keyboard = { top: 0, height: 400 };
    const target = { top: 330, bottom: 420 };

    const delta = revealScrollDelta(target, keyboard);

    // 見える下端は 400 - 12 = 388。エラー文の下端 420 をそこへ入れる。
    expect(delta).toBe(420 - (400 - REVEAL_MARGIN));
  });

  it("画面下に固定する帯のぶんも避ける", () => {
    const target = { top: 400, bottom: 470 };
    const delta = revealScrollDelta(target, FULL, { reservedBottom: 120 });

    // 見える下端は 800 - 120 - 12 = 668 なので、まだ収まっている。
    expect(delta).toBe(0);

    expect(
      revealScrollDelta({ top: 600, bottom: 700 }, FULL, { reservedBottom: 120 }),
    ).toBe(700 - (800 - 120 - REVEAL_MARGIN));
  });

  it("欄が上へはみ出していれば、上端を余白の下へ送る（負の量）", () => {
    const delta = revealScrollDelta({ top: 40, bottom: 120 }, { top: 100, height: 700 });

    expect(delta).toBe(40 - (100 + REVEAL_MARGIN));
  });

  it("visualViewport がずれている（キーボードで画面が押し上げられた）ときも同じ基準で測る", () => {
    const delta = revealScrollDelta({ top: 780, bottom: 860 }, { top: 200, height: 600 });

    // 見える下端は 200 + 600 - 12 = 788。
    expect(delta).toBe(860 - 788);
  });

  it("画面より高いまとまりは、エラー文の下端を見せる（上を切る）", () => {
    const keyboard = { top: 0, height: 300 };

    // まとまり自体が 280px を超えている。下辺だけを収める。
    expect(revealScrollDelta({ top: 100, bottom: 500 }, keyboard)).toBe(
      500 - (300 - REVEAL_MARGIN),
    );

    // すでに下辺が収まっていれば、上を切ったまま動かさない。
    expect(revealScrollDelta({ top: 10, bottom: 287 }, keyboard)).toBe(0);
  });
});
