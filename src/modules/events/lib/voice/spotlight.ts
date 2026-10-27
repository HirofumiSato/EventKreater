/**
 * 音声モードの覆い（`.voice-scrim`）からくり抜く穴の計算。
 *
 * 穴の高さは欄に合わせず固定にする。欄に合わせて測ると、画面外にある欄の矩形で
 * 穴を空けてしまい、スクロールや画面幅でずれる。高さを固定し、欄の中央へ穴の中央を
 * 合わせる（画面端では高さを保ったまま穴だけが欄を追う）。幅は縦スクロールで動かないため、
 * 欄の実測に合わせて伸縮させる。
 *
 * DOM を読まない純ロジック。矩形とビューポートの高さだけを受け取る。
 */

/** 音声モードの覆いからくり抜く矩形。ビューポート座標。 */
export interface VoiceSpotlight {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 計測に使う矩形。`getBoundingClientRect()` の必要な項目だけ。 */
export interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 強調の枠（outline 3px + 余白 2px）が隠れないように、矩形を外側へ広げる量。 */
export const SPOTLIGHT_PADDING = 6;

/**
 * くり抜く穴の高さ。単一行の input/select（約 40px）に、強調の枠と余白が収まる固定値。
 * 欄の高さには追従させない。
 */
export const SPOTLIGHT_HEIGHT = 64;

/**
 * 欄の矩形から、くり抜く穴を決める。
 *
 * 欄の中央がビューポートの中央に来るよう穴を置き、画面端で寄せ切れないときは
 * 高さを保ったまま 0〜`viewportHeight - SPOTLIGHT_HEIGHT` の範囲へ収める。
 */
export function spotlightFor(rect: SpotlightRect, viewportHeight: number): VoiceSpotlight {
  const fieldCenter = rect.top + rect.height / 2;
  const viewportCenter = viewportHeight / 2;
  const centered = (viewportHeight - SPOTLIGHT_HEIGHT) / 2 + (fieldCenter - viewportCenter);
  const maxTop = Math.max(0, viewportHeight - SPOTLIGHT_HEIGHT);
  return {
    top: Math.min(Math.max(0, centered), maxTop),
    left: Math.max(0, rect.left - SPOTLIGHT_PADDING),
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: SPOTLIGHT_HEIGHT,
  };
}

/**
 * 矩形の外側を覆い、内側だけをくり抜く clip-path を作る。
 * 外周を時計回り、穴を反時計回りに描くと、既定の nonzero 規則で穴になる。
 */
export function spotlightClipPath({ top, left, width, height }: VoiceSpotlight): string {
  const right = left + width;
  const bottom = top + height;
  return (
    "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, " +
    `${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ` +
    `${right}px ${top}px, ${left}px ${top}px)`
  );
}
