/**
 * 音声パネル（`.voice-panel`）を強調中の入力欄のすぐ下へ置くための計算。
 *
 * 右下へ固定すると、いま聞いている欄とパネルが離れて視線が行き来する。
 * 欄の直下に置けば、質問と答えの欄が 1 か所にまとまる。位置はスクロールで動くため、
 * 測り直すたびにこの関数で作り直す。
 *
 * DOM を読まない純ロジック。矩形と FAB の左端だけを受け取る。
 */

/** パネルの置き場所。ビューポート座標。 */
export interface VoicePanelBox {
  top: number;
  left: number;
  width: number;
}

/** 計測に使う欄の矩形。`getBoundingClientRect()` の必要な項目だけ。 */
export interface PanelFieldRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 欄とパネルのあいだに空ける余白（px）。 */
export const PANEL_GAP = 8;

/**
 * 欄の中心を置く、画面の高さに対する割合。
 *
 * 中央（0.5）に置くと、欄の下に出るパネルの居場所が残らない。上寄りの 35% に置くと、
 * パネルが欄のすぐ下に収まり、下に固定する帯（`--final-bar-h`）とも重ならない。
 */
export const FIELD_ANCHOR_RATIO = 0.35;

/**
 * 欄を画面の上寄りへ寄せるために、縦にスクロールする量（px）。
 *
 * 正なら下へ、負なら上へ送る。欄の中心が `ratio` の位置に来る量をそのまま返し、
 * 0 で止めない。止めると、画面の上へはみ出した欄（戻る・スキップで前の欄へ戻ったとき）を
 * 画面の外に残したまま、パネルだけを出すことになる。画面の端で寄せ切れない分は、
 * ブラウザがスクロールの限界で吸収する。
 */
export function fieldScrollDelta(
  rect: Pick<PanelFieldRect, "top" | "height">,
  viewportHeight: number,
  ratio: number = FIELD_ANCHOR_RATIO,
): number {
  return rect.top + rect.height / 2 - viewportHeight * ratio;
}

/**
 * 欄の矩形から、パネルを置く箱を決める。
 *
 * 上端は欄の下端に `gap` を足した位置（欄のすぐ下）。左端は欄の左で、画面外へはみ出す
 * ときは 0 に寄せる。右端は欄の右端までだが、`fabLeft` を渡したときは `fabLeft - gap`
 * で止める（右下の FAB と重ねない）。幅は右端から左端を引いた値で、負にはならない。
 */
export function panelBoxFor(
  field: PanelFieldRect,
  fabLeft?: number,
  gap: number = PANEL_GAP,
): VoicePanelBox {
  const left = Math.max(0, field.left);
  const fieldRight = field.left + field.width;
  const right = fabLeft === undefined ? fieldRight : Math.min(fieldRight, fabLeft - gap);
  return {
    top: field.top + field.height + gap,
    left,
    width: Math.max(0, right - left),
  };
}
