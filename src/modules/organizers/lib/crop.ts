/**
 * プロフィールのヘッダー画像を 3:1 に切り出すための計算。
 *
 * DOM にも Next.js にも依存しない純関数だけを置く。`ImageCropDialog` はここの結果を
 * そのまま描画に使い、画面側へ計算を書き戻さない。単体試験も同じ関数を呼ぶ。
 *
 * 用語:
 * - 枠: 画面に出す 3:1 の表示領域（`frameW` × `frameH`）。
 * - cover: 画像が枠をちょうど覆う倍率（`coverScale`）。画像の縦横比が枠と違うぶん、はみ出した側が隠れる。
 * - zoom: cover に掛ける係数。`1` が cover そのもの、`3` が上限。
 * - ずらし幅（offset）: 枠の中での画像の位置。`0` が中央、正の値で右・下へ動かす。
 *   単位は枠の CSS ピクセル。ずらせるのは、はみ出した幅の半分までで、端に隙間は残さない。
 */

/** ヘッダーの最小切り出し幅（px）。これより狭い切り出しは受け付けない。 */
export const MIN_HEADER_CROP_WIDTH = 800;

/** 拡大の下限。`1` は「枠をちょうど覆う」倍率。 */
export const MIN_ZOOM = 1;

/** 拡大の上限。スライダーの右端。 */
export const MAX_ZOOM = 3;

/** 枠と元画像の大きさ。すべて CSS ピクセル。 */
export interface CropGeometry {
  /** 元画像の幅。EXIF の向きを適用したあとの値。 */
  naturalW: number;
  /** 元画像の高さ。 */
  naturalH: number;
  /** 枠の幅。 */
  frameW: number;
  /** 枠の高さ。 */
  frameH: number;
}

/** 枠の中での画像のずらし幅。 */
export interface CropOffset {
  /** 横のずらし幅。正で右へ。 */
  offsetX: number;
  /** 縦のずらし幅。正で下へ。 */
  offsetY: number;
}

/** 元画像座標での切り出し矩形。 */
export interface CropSourceRect {
  /** 左端（元画像座標、整数）。 */
  x: number;
  /** 上端（元画像座標、整数）。 */
  y: number;
  /** 幅（整数、1 以上）。 */
  width: number;
  /** 高さ（整数、1 以上）。 */
  height: number;
}

/**
 * 画像が枠をちょうど覆う倍率（cover）を返す。
 *
 * 幅・高さの比の大きいほうを採るので、拡大後の画像は縦横とも枠以上になる。
 * 画像が枠と同じ縦横比なら、拡大後の大きさは枠と一致する。
 * 0 以下の大きさが渡されたときは、計算を壊さないよう `1` を返す。
 */
export function coverScale(naturalW: number, naturalH: number, frameW: number, frameH: number): number {
  if (naturalW <= 0 || naturalH <= 0 || frameW <= 0 || frameH <= 0) return 1;
  return Math.max(frameW / naturalW, frameH / naturalH);
}

/** ずらせる幅の上限（片側）。はみ出しが無ければ 0。 */
function offsetSlack(scaledSize: number, frameSize: number): number {
  return Math.max(0, scaledSize - frameSize) / 2;
}

/**
 * ずらし幅を、端に隙間が残らない範囲へ収める。
 *
 * 範囲は ±(拡大後の大きさ - 枠の大きさ)/2。`0` が中央なので、両端で同じだけ動かせる。
 * 拡大後の大きさが枠と同じ軸（はみ出し 0）では、必ず `0` になる。
 */
export function clampOffset(offset: number, scaledSize: number, frameSize: number): number {
  const slack = offsetSlack(scaledSize, frameSize);
  if (slack === 0) return 0;
  return Math.min(slack, Math.max(-slack, offset));
}

/**
 * 倍率を変えたときのずらし幅を返す。枠の中心にある画素は動かさない。
 *
 * 中心を保つには、ずらし幅を倍率の比だけ伸ばせばよい（`offset * toZoom / fromZoom`）。
 * 伸ばした結果が端を超える場合は `clampOffset` で収める。
 * 倍率が 0 以下だったときは `MIN_ZOOM` として扱う。
 */
export function zoomAroundCenter(
  params: CropGeometry & {
    /** 変更前の倍率。 */
    fromZoom: number;
    /** 変更後の倍率。 */
    toZoom: number;
    /** 変更前の横のずらし幅。 */
    offsetX: number;
    /** 変更前の縦のずらし幅。 */
    offsetY: number;
  },
): CropOffset {
  const { naturalW, naturalH, frameW, frameH } = params;
  const base = coverScale(naturalW, naturalH, frameW, frameH);
  const from = params.fromZoom > 0 ? params.fromZoom : MIN_ZOOM;
  const to = params.toZoom > 0 ? params.toZoom : MIN_ZOOM;
  const ratio = to / from;
  return {
    offsetX: clampOffset(params.offsetX * ratio, naturalW * base * to, frameW),
    offsetY: clampOffset(params.offsetY * ratio, naturalH * base * to, frameH),
  };
}

/** 開始位置と長さを、`0` 以上 `limit` 以下に収まる整数の区間へ丸める。長さは 1 以上。 */
function integerSpan(start: number, size: number, limit: number): { start: number; size: number } {
  const from = Math.max(0, Math.min(Math.round(start), limit - 1));
  const to = Math.min(limit, Math.max(Math.round(start + size), from + 1));
  return { start: from, size: Math.max(1, to - from) };
}

/**
 * 枠に入っている範囲を、元画像座標の整数矩形にする。
 *
 * 画像を cover × zoom で拡大し、ずらし幅を足した状態から、枠に重なる部分だけを逆算する。
 * 戻り値は必ず元画像の内側に収まり、`width` / `height` は 1 以上になる。
 * 端数は四捨五入するので、同じ入力なら常に同じ矩形になる。
 * 大きさが 0 以下の画像が渡されたときは `1` × `1` を返す。
 */
export function cropSourceRect(
  params: CropGeometry & {
    /** 倍率（cover に掛ける係数）。 */
    zoom: number;
    /** 横のずらし幅。範囲外なら内部で `clampOffset` する。 */
    offsetX: number;
    /** 縦のずらし幅。範囲外なら内部で `clampOffset` する。 */
    offsetY: number;
  },
): CropSourceRect {
  const { naturalW, naturalH, frameW, frameH, zoom } = params;
  if (naturalW < 1 || naturalH < 1) return { x: 0, y: 0, width: 1, height: 1 };

  const base = coverScale(naturalW, naturalH, frameW, frameH);
  const scale = base * (zoom > 0 ? zoom : MIN_ZOOM);
  const offsetX = clampOffset(params.offsetX, naturalW * scale, frameW);
  const offsetY = clampOffset(params.offsetY, naturalH * scale, frameH);

  // 枠に入る元画像の幅と高さ（拡大の逆算）。
  const cropW = frameW / scale;
  const cropH = frameH / scale;
  // 中央から offset だけ動かしたときの、枠の左上が指す元画像の座標。
  const startX = (naturalW - cropW) / 2 - offsetX / scale;
  const startY = (naturalH - cropH) / 2 - offsetY / scale;

  const spanX = integerSpan(startX, cropW, naturalW);
  const spanY = integerSpan(startY, cropH, naturalH);
  return { x: spanX.start, y: spanY.start, width: spanX.size, height: spanY.size };
}

/** 指定の倍率で切り出したときの、元画像側の幅。 */
function cropWidthAtZoom(
  naturalW: number,
  naturalH: number,
  frameW: number,
  frameH: number,
  zoom: number,
): number {
  const base = coverScale(naturalW, naturalH, frameW, frameH);
  return frameW / (base * (zoom > 0 ? zoom : MIN_ZOOM));
}

/**
 * 切り出し幅が `minWidth` を割らない最大の倍率を返す。
 *
 * 幅は「枠の幅 ÷ (cover × zoom)」なので、`minWidth` に等しくなる倍率が上限になる。
 * 上限が `MIN_ZOOM` を下回るときは `1` を返す（それでも足りない画像は、拡大を止めるだけでは
 * 800px を満たせない。`isCropLargeEnough` で判定する）。
 * `MAX_ZOOM` では切らないので、画面側はこの値と `MAX_ZOOM` の小さいほうを使う。
 * `minWidth` が 0 以下なら制限なしとして `Infinity` を返す。
 */
export function maxZoomForMinCrop(
  naturalW: number,
  naturalH: number,
  frameW: number,
  frameH: number,
  minWidth: number = MIN_HEADER_CROP_WIDTH,
): number {
  const base = coverScale(naturalW, naturalH, frameW, frameH);
  if (!(minWidth > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(MIN_ZOOM, frameW / (base * minWidth));
}

/**
 * 指定の倍率で切り出した幅が `minWidth` 以上か。
 *
 * `maxZoomForMinCrop` と同じ式で比べるので、上限の倍率では必ず `true` になる。
 * `minWidth` が 0 以下なら常に `true`。
 */
export function isCropLargeEnough(
  naturalW: number,
  naturalH: number,
  frameW: number,
  frameH: number,
  zoom: number,
  minWidth: number = MIN_HEADER_CROP_WIDTH,
): boolean {
  if (!(minWidth > 0)) return true;
  return cropWidthAtZoom(naturalW, naturalH, frameW, frameH, zoom) >= minWidth;
}
