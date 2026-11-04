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
 * パネルと穴のあいだに空ける余白。穴の下端をこの分だけパネルより上へ上げる。
 */
export const SPOTLIGHT_RESERVED_GAP = 8;

/**
 * 欄の矩形から、くり抜く穴を決める。
 *
 * 欄の中央がビューポートの中央に来るよう穴を置き、画面端で寄せ切れないときは
 * 高さを保ったまま 0〜`viewportHeight - SPOTLIGHT_HEIGHT` の範囲へ収める。
 *
 * `reservedBottom` にはパネルの上端（ビューポート座標）を渡す。渡すと、穴の下端が
 * `reservedBottom - SPOTLIGHT_RESERVED_GAP` を超えないように上へ寄せる。パネルが
 * 高くなっても、欄がパネルの下へ隠れない。省略したときは従来どおり画面の下端まで使う。
 */
export function spotlightFor(
  rect: SpotlightRect,
  viewportHeight: number,
  reservedBottom?: number,
): VoiceSpotlight {
  const fieldCenter = rect.top + rect.height / 2;
  const viewportCenter = viewportHeight / 2;
  const centered = (viewportHeight - SPOTLIGHT_HEIGHT) / 2 + (fieldCenter - viewportCenter);
  const limit =
    reservedBottom === undefined
      ? viewportHeight
      : Math.min(viewportHeight, reservedBottom - SPOTLIGHT_RESERVED_GAP);
  const maxTop = Math.max(0, limit - SPOTLIGHT_HEIGHT);
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

/** 丸い穴を多角形で表すときの頂点数。半径 26px なら 32 で、縁の角は 1px 未満になる。 */
export const SPOTLIGHT_CIRCLE_SEGMENTS = 32;

/** 座標を 0.01px までに丸める。文字列を短くし、同じ矩形なら必ず同じ値にするため。 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 矩形の外側を覆い、内側を楕円（正方形なら真円）にくり抜く clip-path を作る。
 *
 * `path()` は evenodd を書ける環境が限られるため、輪郭を閉じた多角形で近似する。
 * 中心を決めるのは幅・高さだけで、`top` / `left` は中心の位置に使う。
 * 穴は反時計回りにたどる（外周の時計回りと逆向きにすると nonzero 規則で穴になる）。
 */
export function circleSpotlightClipPath(
  { top, left, width, height }: VoiceSpotlight,
  segments: number = SPOTLIGHT_CIRCLE_SEGMENTS,
): string {
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const count = Math.max(3, Math.round(segments));
  const points: string[] = [];
  for (let index = 0; index < count; index += 1) {
    // 角度を負の向きに進める。画面座標は y が下向きなので、これが反時計回りになる。
    const angle = (-2 * Math.PI * index) / count;
    const x = round(centerX + radiusX * Math.cos(angle));
    const y = round(centerY + radiusY * Math.sin(angle));
    points.push(`${x}px ${y}px`);
  }
  // 穴の始点をもう一度置いて閉じる。多角形は自動で閉じるが、形を目で追えるようにする。
  points.push(points[0]);
  return `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${points.join(", ")})`;
}
