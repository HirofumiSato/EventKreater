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
