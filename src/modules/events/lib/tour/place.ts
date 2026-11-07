/**
 * 初回ガイドの配置計算。
 *
 * 対象の矩形・画面の大きさ・吹き出しの大きさだけを受け取り、DOM を読まない。
 * くり抜きの描き方（`clip-path`）は音声モードと同じ形を使うため、ここでは持たない
 * （`src/modules/events/lib/voice/spotlight.ts` の `spotlightClipPath` をそのまま呼ぶ）。
 */

/** 計測した矩形。`getBoundingClientRect()` の必要な項目だけ。 */
export interface GuideRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 画面の内側の大きさ。`window.innerWidth` / `innerHeight` を渡す。 */
export interface GuideViewport {
  width: number;
  height: number;
}

/** くり抜く穴。ビューポート座標。 */
export interface GuideHole {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 吹き出しの実測値。中身で高さが変わるので、毎回測って渡す。 */
export interface GuideSize {
  width: number;
  height: number;
}

export type GuideBubbleSide = "above" | "below";

export interface GuideBubblePlacement {
  top: number;
  left: number;
  /** 穴の上に置いたか、下に置いたか。尾を出す向きに使う。 */
  side: GuideBubbleSide;
}

/** 穴を対象の矩形より外側へ広げる量。強調の枠（2px）と余白が収まる幅。 */
export const GUIDE_HOLE_PADDING = 8;

/**
 * 穴の高さの上限。画面の高さに対する割合。
 *
 * テーマ選択のように 600px を超える欄は、そのまま穴にするとスマホでは画面が
 * 穴だけで埋まり、吹き出しを置く場所が無くなる。6 割で止めて、残りを吹き出しに渡す。
 */
export const GUIDE_HOLE_RATIO = 0.6;

/**
 * 穴の高さの下限。画面が低いときに 6 割で切ると、対象が読めない高さまで縮むため。
 * 対象そのものが小さいときは、この値まで広げない（穴は対象に沿わせる）。
 */
export const GUIDE_HOLE_MIN_HEIGHT = 120;

/** 穴と吹き出しのあいだに空ける距離。 */
export const GUIDE_BUBBLE_GAP = 12;

/** 吹き出しと画面の端に空ける距離。 */
export const GUIDE_VIEWPORT_MARGIN = 12;

/**
 * 見せるスクロールの速さ（px/ミリ秒）。約 600px/秒。
 *
 * 距離で速さを変えないための基準。時間を距離に比例させないと、遠いほど 1 秒あたりの
 * 移動が増えて「高速でスクロールした」と見える。短い移動だけは下限で頭打ちにする。
 *
 * この速さより速く動かす場面は無い。飛ばす（一瞬で位置を変える）こともしない。
 * 飛ばすと、スクロールではない瞬間移動が「高速のスクロール」として見える。
 */
export const GUIDE_TRAVEL_SPEED = 0.6;
/** 短い移動でも、赤い枠を見せておく最低の時間。 */
export const GUIDE_TRAVEL_MIN_MS = 420;
/** スクロールが始まる前の待ち。開いたステップの `deco-step-in`（260ms）を待つ。 */
export const GUIDE_TRAVEL_DELAY_MS = 280;
/**
 * 送る距離が無いときでも、赤い枠を見せておく長さ。移動が 0px の枚（1 枚目 → 2 枚目）で
 * 枠が一瞬だけ点滅するより、同じ順で「触れない」を見せたほうが意味が伝わる。
 */
export const GUIDE_TRAVEL_HOLD_MS = 200;
/**
 * 紙を出す前の送り直し。紙が伸びて目的地が動いたときに、**紙を出さずに**詰め直す回数。
 *
 * 紙を出したあとに送ると「モーダルが出たのに画面が動く」ことになり、どこを見ればよいか
 * 分からなくなる。だから紙を出す前に十分近づける。
 *
 * `GUIDE_SETTLE_MIN_DISTANCE` 未満のずれは送らない。穴は毎描画で測り直しているので、
 * 多少ずれても対象は囲んだまま。目に見えない移動のために待たせない。
 */
export const GUIDE_SETTLE_COUNT = 2;
export const GUIDE_SETTLE_MIN_DISTANCE = 160;
/**
 * 送りが止まってから、黒い面と紙を出すまでの間。
 *
 * 止まった瞬間に黒くすると、着いた場所（どの欄か）を見る間が無いまま紙に覆われる。
 * 赤い枠だけの画面のまま少し置いて、目を目的地へ移してもらってから、黒面と紙を同時に出す。
 * 動きではなく「見る時間」なので、距離では変えない。
 *
 * 待っているあいだ、右上にこの長さを数える輪（`.guide-count`）を出す。
 * いつ紙が出るかが見えていれば、止まって見える時間も待ちとして伝わる。
 */
export const GUIDE_REVEAL_HOLD_MS = 3000;
/**
 * これ未満の距離は「動かさない」と見なす。11px を 420ms かけて動かしても目には分からず、
 * 待たされただけになる。位置はその場で合わせ、枠だけを見せてから次の枚を出す。
 */
export const GUIDE_TRAVEL_MIN_DISTANCE = 24;

/** 移動にかける時間。距離に比例させる（速さを変えない）。 */
export function travelDuration(distance: number): number {
  return Math.round(Math.max(GUIDE_TRAVEL_MIN_MS, Math.abs(distance) / GUIDE_TRAVEL_SPEED));
}

/** 押せる合図（手）の大きさ。指先が読める最小で、見出しの高さ（56px）に収める。 */
export const GUIDE_TAP_SIZE = 32;

/**
 * 手の中の指先の位置（箱の左上を 0、右下を 1 とした割合）。
 * CSS の `transform-origin` と波の位置（`48% 12%`）と同じ値にする。
 * ここがずれると、押している場所と指先の動きがちぐはぐに見える。
 */
export const GUIDE_TAP_TIP_X = 0.48;

/** 手を穴の端から内側へ寄せる量。枠（2px）と余白に重ねない。 */
export const GUIDE_TAP_INSET = 6;

/**
 * 3 つの見出しを順に押すように見せる、枚ごとの遅れ。
 * 同時に 3 つの手が跳ねると、どれを押せばよいか分からない。
 */
export const GUIDE_TAP_STAGGER_MS = 320;

/**
 * 押せる合図（手）の置き場所。ビューポート座標で、手の左上を返す。
 *
 * 穴の真ん中に置く。見出しの文の上に重なるが、押せることを真似る合図なので、
 * 端に寄せるより「この見出しを押す」が伝わる。指先は手の上の中央（`x ≈ 48%`）に
 * 来るので、指先が穴の中心に落ちるよう少しだけ左へ寄せる。
 */
export function tapPoint(
  hole: GuideRect,
  size = GUIDE_TAP_SIZE,
  inset = GUIDE_TAP_INSET,
): { top: number; left: number } {
  // 指先（48%）が穴の中心へ来る位置。中心に手の箱を置くと、指先が少し右へずれる。
  const tipOffset = size * GUIDE_TAP_TIP_X;
  const left = clamp(
    hole.left + hole.width / 2 - tipOffset,
    hole.left + inset,
    Math.max(hole.left + inset, hole.left + hole.width - size),
  );
  const top = clamp(
    hole.top + (hole.height - size) / 2,
    hole.top + inset,
    Math.max(hole.top + inset, hole.top + hole.height - size),
  );
  return { top: Math.round(top), left: Math.round(left) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 複数の矩形を 1 つの外接矩形にまとめる。空なら null。
 * 1 枚目の 3 つの見出しを、1 つの穴で囲むために使う。
 */
export function unionRect(rects: readonly GuideRect[]): GuideRect | null {
  if (rects.length === 0) return null;
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return { top, left, width: right - left, height: bottom - top };
}

export interface GuideHoleOptions {
  /** 画面の高さに対する上限の割合。既定は `GUIDE_HOLE_RATIO`。 */
  ratio?: number;
  /** 上限の下限。既定は `GUIDE_HOLE_MIN_HEIGHT`。 */
  minHeight?: number;
  /**
   * 画面の下から空ける高さ。吹き出しと余白のぶんを渡す。
   * 穴が画面の下端まで伸びて、吹き出しの置き場を奪わないようにする。
   */
  reservedBottom?: number;
  /** 対象の矩形の外側へ広げる量。既定は `GUIDE_HOLE_PADDING`。 */
  padding?: number;
}

/** 対象に余白を足した「そのまま見せたい高さ」。 */
function naturalHeight(rect: GuideRect, padding: number): number {
  return rect.height + padding * 2;
}

/**
 * 穴の高さ。画面の 6 割（既定）と、画面の下に固定した帯を除いた高さの小さい方で止める。
 *
 * 上限そのものにも下限を持たせる。画面が低いときに 6 割だけを信じると、
 * 対象が読めない高さまで縮んでしまう。
 */
function holeHeight(
  rect: GuideRect,
  viewport: GuideViewport,
  options: GuideHoleOptions,
): number {
  const padding = Math.max(0, options.padding ?? GUIDE_HOLE_PADDING);
  const ratio = options.ratio ?? GUIDE_HOLE_RATIO;
  const minHeight = Math.max(0, options.minHeight ?? GUIDE_HOLE_MIN_HEIGHT);
  const reservedBottom = Math.max(0, options.reservedBottom ?? 0);

  const available = Math.max(0, viewport.height - reservedBottom);
  const limit = Math.min(viewport.height * ratio, available, viewport.height);
  return Math.min(naturalHeight(rect, padding), Math.max(minHeight, limit));
}

/**
 * 対象の矩形から、画面の内側に収まる穴を決める。
 *
 * 高さは「対象 + 余白」を基本にし、画面の 6 割（既定）で止める。幅は縦スクロールで
 * 変わらないので、対象の実測に余白を足したまま画面内へ寄せる。
 *
 * 高さを止めた（対象が入りきらない）ときは、**対象の上辺へ穴の上辺をそろえる**。
 * 中心に合わせると、穴の上辺が対象の途中（見出しの下など）に落ち、枠が「どこから
 * どこまでか」を示さなくなる。上辺をそろえれば、枠の上辺が対象の上辺と一致し、
 * 続きが画面の外にあることが読み取れる。対象が見出しごと読める位置へ送るのは
 * `planScroll()` の仕事。
 */
export function clampHole(
  rect: GuideRect,
  viewport: GuideViewport,
  options: GuideHoleOptions = {},
): GuideHole {
  const padding = Math.max(0, options.padding ?? GUIDE_HOLE_PADDING);
  const height = holeHeight(rect, viewport, options);
  const width = Math.min(rect.width + padding * 2, viewport.width);

  const centerY = rect.top + rect.height / 2;
  const overflowing = naturalHeight(rect, padding) > height;
  const rawTop = overflowing ? rect.top - padding : centerY - height / 2;
  const top = clamp(rawTop, 0, Math.max(0, viewport.height - height));
  const left = clamp(rect.left - padding, 0, Math.max(0, viewport.width - width));

  return { top, left, width, height };
}

export interface GuideScrollOptions extends GuideHoleOptions {
  /** 画面の上端から空ける距離。既定は `GUIDE_VIEWPORT_MARGIN`。 */
  margin?: number;
  /**
   * 吹き出しの実測。渡すと「吹き出しが穴に重ならない位置」まで考えて寄せる。
   * 渡さないと、対象が見えているかどうかだけで決める。
   */
  bubble?: GuideSize;
}

/**
 * 対象を画面のどこへ寄せるかを決める。返すのは縦に動かす量（正で下へ）。
 * 動かさなくてよいときは `null`。
 *
 * - 画面に収まらない欄（料金・テーマ・チラシ）は、上辺を画面の上端近くへそろえる。
 *   中心に合わせると対象の頭（見出し）が画面の外へ出て、何の説明か分からなくなる。
 * - 収まる欄は、いまの位置のままで「全体が見えていて、吹き出しも穴に重ならない」なら
 *   動かさない。動かすのは、そこから外れたときだけ。
 * - 動かすときは、置いてよい範囲の最も近い端へ寄せる。中央へ飛ばすと、
 *   33px で済む場面で 200px もスクロールして「飛んだ」ように見える。
 *
 * 何度呼んでも同じ答えになる（寄せ終われば `null`）ので、測り直しのたびに呼べる。
 */
export function planScroll(
  rect: GuideRect,
  viewport: GuideViewport,
  options: GuideScrollOptions = {},
): number | null {
  const padding = Math.max(0, options.padding ?? GUIDE_HOLE_PADDING);
  const margin = Math.max(0, options.margin ?? GUIDE_VIEWPORT_MARGIN);
  const reservedBottom = Math.max(0, options.reservedBottom ?? 0);
  const available = Math.max(0, viewport.height - reservedBottom);
  const height = holeHeight(rect, viewport, options);
  const gap = GUIDE_BUBBLE_GAP;

  /** 対象の上辺を置いてよい位置の範囲。 */
  const ranges: Array<readonly [number, number]> = [];
  const topMin = margin + padding;
  const topMax = available - margin - padding - rect.height;

  if (naturalHeight(rect, padding) > height) {
    // 収まらない欄は頭をそろえる。穴の高さは `clampHole` が止めるので、
    // 続きは画面の外（黒い面の下）にあると読み取れる。
    ranges.push([margin, margin]);
  } else {
    const bubble = options.bubble;
    if (bubble) {
      // 上に置ける下限と、下に置ける上限。あいだに「どちらにも置けない帯」ができる。
      const above = topMin + gap + bubble.height;
      const below = topMax - gap - bubble.height;
      if (below >= topMin) ranges.push([topMin, Math.min(below, topMax)]);
      if (above <= topMax) ranges.push([Math.max(above, topMin), topMax]);
      if (ranges.length === 0) {
        // 穴も吹き出しも同時には入らない。対象を上端へ寄せ、吹き出しは穴の下へ置く
        // （`fitHoleToBubble` が穴を縮めて居場所を作る）。
        ranges.push([margin, margin]);
      }
    } else {
      ranges.push([topMin, topMax]);
    }
  }

  // いまの位置がそのまま使えるなら動かさない（1px 未満は丸め誤差として無視する）。
  if (ranges.some(([min, max]) => rect.top >= min - 0.5 && rect.top <= max + 0.5)) {
    return null;
  }

  const nearest = ranges
    .flat()
    .reduce((best, value) =>
      Math.abs(value - rect.top) < Math.abs(best - rect.top) ? value : best,
    );
  const delta = rect.top - nearest;
  return Math.abs(delta) < 1 ? null : delta;
}

/**
 * 吹き出しが穴に重ならないよう、穴の高さを詰める。
 *
 * 対象が高い枚では、6 割で切った穴の上下どちらにも吹き出しが収まらないことがある
 * （料金やテーマの欄）。そのとき `placeBubble` は画面の端で吹き出しを止めるため、
 * 穴の上端を吹き出しが覆ってしまう。覆うと「どこを説明しているか」が見えなくなるので、
 * 下に置ける高さまで穴を縮めて、吹き出しの居場所を空ける。
 *
 * 縮めるのは、上が足りず下も足りないときだけ。どちらかに収まるなら対象の実寸を優先する。
 * 下を優先するのは、ページを下へ読む流れと同じ向きで、対象の頭が隠れないため。
 */
export function fitHoleToBubble(
  hole: GuideHole,
  viewport: GuideViewport,
  bubble: GuideSize,
  safeBottom = 0,
): GuideHole {
  const margin = GUIDE_VIEWPORT_MARGIN;
  const gap = GUIDE_BUBBLE_GAP;
  const bottomLimit = Math.max(0, viewport.height - Math.max(0, safeBottom));

  const spaceAbove = hole.top - gap - margin;
  const spaceBelow = bottomLimit - (hole.top + hole.height) - gap;
  if (spaceAbove >= bubble.height || spaceBelow >= bubble.height) return hole;

  const roomBelow = bottomLimit - margin - gap - bubble.height - hole.top;
  if (roomBelow < GUIDE_HOLE_MIN_HEIGHT) return hole;
  return { ...hole, height: Math.min(hole.height, roomBelow) };
}

/**
 * 複数の穴を 1 つの `clip-path` でくり抜く。
 *
 * 穴はどれも「左上 → 左下 → 右下 → 右上」と反時計回りにたどる。外周を時計回りに
 * 描いておけば、既定の nonzero 規則で内側が穴になる（1 つのときの `spotlightClipPath`
 * と同じ考え方）。穴が空なら画面全体を覆う形を返し、何も見せない。
 */
export function guideClipPath(holes: readonly GuideHole[]): string {
  const outer = "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0";
  if (holes.length === 0) return `${outer})`;
  const parts = holes.map(({ top, left, width, height }) => {
    const right = left + width;
    const bottom = top + height;
    return `${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px`;
  });
  return `${outer}, ${parts.join(", ")})`;
}

/** 複数の穴をまとめた外接矩形。吹き出しを穴の並びに対して置くときに使う。 */
export function boundsOfHoles(holes: readonly GuideHole[]): GuideHole | null {
  if (holes.length === 0) return null;
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const hole of holes) {
    top = Math.min(top, hole.top);
    left = Math.min(left, hole.left);
    right = Math.max(right, hole.left + hole.width);
    bottom = Math.max(bottom, hole.top + hole.height);
  }
  return { top, left, width: right - left, height: bottom - top };
}

/**
 * 吹き出しを穴の上下どちらに置くかを決め、画面内へ寄せる。
 *
 * 下に十分な高さがあれば下（対象より先に本文を読める）、無ければ上へ回す。
 * どちらにも収まらないときは、空きの広い側へ置いて画面の端で切らない。
 * 左右は穴の中心に合わせ、はみ出す分だけ画面内へ寄せる。
 *
 * `safeBottom` には画面下に固定している帯（スマホの `.form-final`）の高さを渡す。
 * 帯はスクロールで動かないので、吹き出しが帯に重ならないよう上端を帯の手前で止める。
 */
export function placeBubble(
  hole: GuideHole,
  viewport: GuideViewport,
  bubble: GuideSize,
  safeBottom = 0,
): GuideBubblePlacement {
  const margin = GUIDE_VIEWPORT_MARGIN;
  const gap = GUIDE_BUBBLE_GAP;

  const maxLeft = Math.max(margin, viewport.width - bubble.width - margin);
  const left = clamp(hole.left + hole.width / 2 - bubble.width / 2, margin, maxLeft);

  const bottomLimit = Math.max(0, viewport.height - Math.max(0, safeBottom));
  const spaceBelow = bottomLimit - (hole.top + hole.height) - gap;
  const spaceAbove = hole.top - gap - margin;

  const side: GuideBubbleSide =
    spaceBelow >= bubble.height
      ? "below"
      : spaceAbove >= bubble.height
        ? "above"
        : spaceBelow >= spaceAbove
          ? "below"
          : "above";

  const rawTop =
    side === "below" ? hole.top + hole.height + gap : hole.top - gap - bubble.height;
  const maxTop = Math.max(margin, bottomLimit - bubble.height - margin);
  const top = clamp(rawTop, margin, maxTop);

  return { top, left, side };
}

/**
 * 吹き出しの基準にする矩形。穴が複数あるとき、まとめた外接矩形では置けないことがある。
 *
 * 2 枚目のように 3 つの見出しを別々に囲む枚で、利用者が見出しを押してステップを開くと、
 * 穴の並びが画面の上から下まで伸びる。その外接矩形を基準にすると吹き出しの居場所が
 * 無くなり、上端へ寄せられて 1 つ目の穴を覆ってしまう。そういうときは穴を 1 つずつ
 * 基準にして、他の穴に重ならない場所を探す（空いている穴を 1 つ隠さずに済む）。
 *
 * どれも重なるなら、まとめた外接矩形をそのまま返す（測り直しは呼び出し側が続ける）。
 */
export function anchorForBubble(
  holes: readonly GuideHole[],
  viewport: GuideViewport,
  bubble: GuideSize,
  safeBottom = 0,
): GuideRect | null {
  const union = boundsOfHoles(holes);
  if (!union) return null;
  if (holes.length < 2) return union;

  // 並びの中央に近い穴から試す。画面の真ん中を見ている人の目に近い場所に紙が出る。
  const center = viewport.height / 2;
  const candidates = [...holes].sort(
    (a, b) =>
      Math.abs(a.top + a.height / 2 - center) - Math.abs(b.top + b.height / 2 - center),
  );

  for (const anchor of [union, ...candidates]) {
    const placement = placeBubble(anchor, viewport, bubble, safeBottom);
    const overlaps = holes.some((hole) => {
      const overlapX =
        placement.left < hole.left + hole.width && hole.left < placement.left + bubble.width;
      const overlapY =
        placement.top < hole.top + hole.height && hole.top < placement.top + bubble.height;
      return overlapX && overlapY;
    });
    if (!overlaps) return anchor;
  }

  return union;
}
