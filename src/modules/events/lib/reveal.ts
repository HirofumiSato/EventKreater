/**
 * エラーのある欄を画面へ収める計算。
 *
 * スマホでは、欄にフォーカスするとキーボード（テンキー）が開き、見えている範囲が
 * 下から削られる。欄だけを見せると、その下に出すエラー文がキーボードの裏へ入る。
 * そこで「欄の上端からエラー文の下端まで」を 1 つのまとまりとして扱い、
 * 見えている範囲へ収めるのに必要なスクロール量だけを返す。
 *
 * 見えている範囲は `window.visualViewport`（無ければ `innerHeight`）から作る。
 * 画面下に固定する帯（`.form-final`）は `reservedBottom` で避ける。
 */

/** 見えている範囲。キーボードが出ているあいだは、そのぶん height が縮む。 */
export interface VisibleArea {
  /** 見えている範囲の上端（ページの上端からの px）。`visualViewport.offsetTop`。 */
  top: number;
  /** 見えている範囲の高さ。`visualViewport.height`。 */
  height: number;
}

/** 欄とエラー文のまとまり。 */
export interface RevealTarget {
  top: number;
  bottom: number;
}

/** 画面の端に空ける余白（px）。 */
export const REVEAL_MARGIN = 12;

/**
 * まとまりを画面へ収めるために、縦にスクロールする量（px）。
 * 正なら下へ、負なら上へ送る。収まっていれば 0。
 *
 * まとまりが高すぎて収まらないとき（長い案内が付いた欄など）は、下側を優先する。
 * 上を切ると入力欄の途中から見えるが、下を切ると直す理由そのものが読めなくなる。
 */
export function revealScrollDelta(
  target: RevealTarget,
  area: VisibleArea,
  options: { margin?: number; reservedBottom?: number } = {},
): number {
  const margin = options.margin ?? REVEAL_MARGIN;
  const reservedBottom = options.reservedBottom ?? 0;
  const visibleTop = area.top + margin;
  const visibleBottom = area.top + area.height - reservedBottom - margin;
  const room = visibleBottom - visibleTop;
  const height = target.bottom - target.top;

  if (height > room) {
    // 収まらない。エラー文の下端だけは見せる。
    return Math.max(0, target.bottom - visibleBottom);
  }
  if (target.top < visibleTop) return target.top - visibleTop;
  if (target.bottom > visibleBottom) return target.bottom - visibleBottom;
  return 0;
}
