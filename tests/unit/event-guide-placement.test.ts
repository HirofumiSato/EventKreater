// 初回ガイド（スポットライトツアー）の配置計算。
//
// 穴と吹き出しの位置は、画面の大きさと対象の実測だけで決まる純ロジック。
// 420px の撮影を待たずに、スマホで穴が画面を埋めないこと・吹き出しが帯に
// 潜らないことをここで固定する。

import { describe, expect, it } from "vitest";
import {
  anchorForBubble,
  boundsOfHoles,
  clampHole,
  fitHoleToBubble,
  GUIDE_TAP_INSET,
  GUIDE_TAP_SIZE,
  guideClipPath,
  placeBubble,
  planScroll,
  tapPoint,
  travelDuration,
  unionRect,
  GUIDE_HOLE_MIN_HEIGHT,
  GUIDE_HOLE_RATIO,
  GUIDE_SETTLE_COUNT,
  GUIDE_SETTLE_MIN_DISTANCE,
  GUIDE_TRAVEL_MIN_DISTANCE,
  GUIDE_TRAVEL_MIN_MS,
  type GuideRect,
  type GuideSize,
} from "@/modules/events/lib/tour/place";

/** スマホの基準（390 × 844）。 */
const PHONE = { width: 390, height: 844 };
/** 実際に測った PC の画面（894 × 625）。費用の欄は 640px で入りきらない。 */
const DESKTOP = { width: 894, height: 625 };

describe("対象の外接矩形", () => {
  it("3 つの見出しを 1 つの矩形にまとめる", () => {
    const union = unionRect([
      { top: 100, left: 10, width: 200, height: 60 },
      { top: 180, left: 10, width: 300, height: 60 },
      { top: 260, left: 10, width: 250, height: 60 },
    ]);

    expect(union).toEqual({ top: 100, left: 10, width: 300, height: 220 });
  });

  it("対象が 1 つも無ければ null を返す（穴を空けない）", () => {
    expect(unionRect([])).toBeNull();
  });
});

describe("穴の収め方", () => {
  it("画面の 6 割より高い欄は、穴の高さを画面の 6 割で止める", () => {
    // テーマ選択の実測（634px）。そのまま穴にすると、スマホでは吹き出しの置き場が無い。
    const hole = clampHole({ top: 200, left: 10, width: 370, height: 634 }, PHONE);

    expect(hole.height).toBeCloseTo(PHONE.height * GUIDE_HOLE_RATIO, 5);
    expect(hole.height).toBeLessThan(634);
  });

  it("止めた穴は欄の上辺にそろえる（枠の上辺を対象の上辺に一致させる）", () => {
    const rect = { top: 200, left: 10, width: 370, height: 634 };
    const hole = clampHole(rect, PHONE);

    expect(hole.top).toBe(rect.top - 8);
    expect(hole.height).toBeLessThan(rect.height + 16);
  });

  it("欄が小さいときは、穴を下限まで広げず欄に沿わせる", () => {
    const hole = clampHole({ top: 100, left: 100, width: 120, height: 40 }, PHONE);

    expect(hole.height).toBe(40 + 8 * 2);
    expect(hole.height).toBeLessThan(GUIDE_HOLE_MIN_HEIGHT);
  });

  it("画面が低くても、穴の上限は 120px を下回らない", () => {
    const hole = clampHole(
      { top: 20, left: 10, width: 100, height: 200 },
      { width: 390, height: 150 },
    );

    expect(hole.height).toBe(GUIDE_HOLE_MIN_HEIGHT);
  });

  it("欄が見えていなければ、穴を画面の上端へ寄せる", () => {
    const hole = clampHole({ top: -400, left: 20, width: 200, height: 40 }, PHONE);

    expect(hole.top).toBe(0);
  });

  it("横にはみ出す欄は、穴を画面の内側へ寄せる", () => {
    const hole = clampHole({ top: 100, left: 380, width: 100, height: 40 }, PHONE);

    expect(hole.left).toBe(PHONE.width - hole.width);
  });
});

describe("対象を画面へ寄せる", () => {
  const BUBBLE = { width: 352, height: 200 };

  it("画面に収まらない欄は、上辺を画面の上端近くへそろえる", () => {
    // 実測: 625px の画面に 640px の費用の欄。中心に合わせると見出しが画面の外へ出た。
    const delta = planScroll({ top: -17, left: 0, width: 464, height: 640 }, DESKTOP);

    expect(delta).toBeCloseTo(-29, 5);
  });

  it("寄せ終わったら動かさない（何度呼んでも同じ答えになる）", () => {
    expect(planScroll({ top: 12, left: 0, width: 464, height: 640 }, DESKTOP)).toBeNull();
  });

  it("吹き出しまで入る位置にある小さい欄は動かさない", () => {
    expect(planScroll({ top: 300, left: 0, width: 200, height: 40 }, PHONE, { bubble: BUBBLE })).toBeNull();
  });

  it("穴と吹き出しのあいだの帯に落ちた欄は、吹き出しが入る側へ最小だけ寄せる", () => {
    // 実測: 894 × 625、必須 3 つの見出し（204px）と 210px の吹き出し。
    // そのままだと吹き出しが 3 つ目の見出しの下端に 19px 重なる。
    const rect = { top: 210, left: 0, width: 464, height: 204 };
    const delta = planScroll(rect, DESKTOP, { bubble: { width: 384, height: 210 } });

    expect(delta).not.toBeNull();
    expect(Math.abs(delta as number)).toBeLessThan(40);
    // 寄せたあとは、穴の下に吹き出しが収まる
    const top = rect.top - (delta as number);
    expect(top + rect.height + 12 + 210).toBeLessThanOrEqual(DESKTOP.height - 12);
  });

  /** 寄せたあとの位置で、吹き出しが穴の上か下に収まるか。 */
  function bubbleFits(top: number, rect: GuideRect, available: number, bubble: GuideSize): boolean {
    const holeTop = Math.max(0, top - 8);
    const holeBottom = holeTop + Math.min(rect.height + 16, available * 0.6);
    return (
      holeTop - 12 - 12 >= bubble.height || available - holeBottom - 12 >= bubble.height
    );
  }

  it("画面の外へ出た小さい欄は、吹き出しのぶんも空けて寄せる", () => {
    const rect = { top: 900, left: 0, width: 200, height: 40 };
    const delta = planScroll(rect, PHONE, { bubble: BUBBLE });

    expect(delta).not.toBeNull();
    expect(bubbleFits(rect.top - (delta as number), rect, PHONE.height, BUBBLE)).toBe(true);
  });

  it("固定の帯に隠れる欄は、帯の上へ寄せる", () => {
    const reservedBottom = 136;
    const rect = { top: 700, left: 0, width: 200, height: 40 };
    const delta = planScroll(rect, PHONE, { reservedBottom, bubble: BUBBLE });

    expect(delta).not.toBeNull();
    expect(
      bubbleFits(rect.top - (delta as number), rect, PHONE.height - reservedBottom, BUBBLE),
    ).toBe(true);
  });
});

describe("吹き出しの置き場所", () => {
  const BUBBLE = { width: 352, height: 200 };

  it("穴の下に十分な高さがあれば、対象の下に置く", () => {
    const hole = { top: 100, left: 100, width: 190, height: 64 };
    const placement = placeBubble(hole, PHONE, BUBBLE);

    expect(placement.side).toBe("below");
    expect(placement.top).toBe(hole.top + hole.height + 12);
  });

  it("穴が画面の下寄りなら、対象の上へ回す", () => {
    const hole = { top: 600, left: 100, width: 190, height: 150 };
    const placement = placeBubble(hole, PHONE, BUBBLE);

    expect(placement.side).toBe("above");
    expect(placement.top).toBe(hole.top - 12 - BUBBLE.height);
  });

  it("左右は穴の中心に合わせる", () => {
    const hole = { top: 100, left: 100, width: 190, height: 64 };
    const placement = placeBubble(hole, PHONE, BUBBLE);

    expect(placement.left).toBe(hole.left + hole.width / 2 - BUBBLE.width / 2);
  });

  it("穴が右に寄っていても、吹き出しは画面からはみ出さない", () => {
    const hole = { top: 100, left: 350, width: 38, height: 40 };
    const placement = placeBubble(hole, PHONE, BUBBLE);

    expect(placement.left).toBe(PHONE.width - BUBBLE.width - 12);
  });

  it("画面下に固定した帯の上で止め、帯に重ねない", () => {
    // スマホの `.form-final` は高さ 8.5rem（136px）で画面下に固定されている。
    const safeBottom = 136;
    const hole = { top: PHONE.height - safeBottom, left: 0, width: 390, height: safeBottom };
    const placement = placeBubble(hole, PHONE, { width: 352, height: 220 }, safeBottom);

    expect(placement.side).toBe("above");
    expect(placement.top).toBe(hole.top - 12 - 220);
    expect(placement.top + 220).toBeLessThanOrEqual(PHONE.height - safeBottom - 12);
  });

  it("どちらにも収まらないときは、空きの広い側へ置いて画面の端で切らない", () => {
    const viewport = { width: 390, height: 600 };
    const hole = { top: 200, left: 100, width: 190, height: 250 };
    const placement = placeBubble(hole, viewport, { width: 352, height: 220 });

    expect(placement.side).toBe("above");
    expect(placement.top).toBe(12);
  });
});

describe("吹き出しの居場所を作る", () => {
  // 実測（390 × 844、下に高さ 98px の固定帯）で、費用とテーマの穴は 6 割の 506px になった。
  // そのまま置くと吹き出しが穴の上端を 34px 覆ったため、穴を縮めて空けるようにした。
  const SAFE_BOTTOM = 98;
  const BUBBLE = { width: 352, height: 181 };

  it("上下どちらにも収まらないときは、下に置ける高さまで穴を縮める", () => {
    const hole = { top: 159, left: 8, width: 374, height: 506 };
    const fitted = fitHoleToBubble(hole, PHONE, BUBBLE, SAFE_BOTTOM);

    expect(fitted.top).toBe(hole.top);
    expect(fitted.height).toBeLessThan(hole.height);
    const placement = placeBubble(fitted, PHONE, BUBBLE, SAFE_BOTTOM);
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(hole.top + fitted.height + 12);
  });

  it("縮めたあとの吹き出しは、穴にも固定の帯にも重ならない", () => {
    const hole = { top: 159, left: 8, width: 374, height: 506 };
    const fitted = fitHoleToBubble(hole, PHONE, BUBBLE, SAFE_BOTTOM);
    const placement = placeBubble(fitted, PHONE, BUBBLE, SAFE_BOTTOM);

    expect(placement.top).toBeGreaterThanOrEqual(fitted.top + fitted.height);
    expect(placement.top + BUBBLE.height).toBeLessThanOrEqual(
      PHONE.height - SAFE_BOTTOM - 12,
    );
  });

  it("どちらかに収まるなら、穴を縮めない（対象の実寸を優先する）", () => {
    const hole = { top: 100, left: 8, width: 374, height: 64 };
    const fitted = fitHoleToBubble(hole, PHONE, BUBBLE, SAFE_BOTTOM);

    expect(fitted).toEqual(hole);
  });

  it("縮めても下限を割るほどしか空かないときは、穴をそのままにする", () => {
    // 画面が低く、固定の帯が高い。下に 120px も空けられない。
    const viewport = { width: 390, height: 400 };
    const hole = { top: 190, left: 8, width: 374, height: 200 };
    const fitted = fitHoleToBubble(hole, viewport, { width: 352, height: 200 }, 40);

    expect(fitted).toEqual(hole);
    expect(fitted.height).toBeGreaterThan(GUIDE_HOLE_MIN_HEIGHT);
  });
});

describe("複数の穴をくり抜く", () => {
  // 1 枚目は 3 つの見出しを 1 つずつ囲む。1 つの箱にまとめると、
  // 「3 つのうちどれを指しているか」が分からなくなる。
  const THREE = [
    { top: 100, left: 20, width: 350, height: 56 },
    { top: 164, left: 20, width: 350, height: 56 },
    { top: 228, left: 20, width: 350, height: 56 },
  ];

  it("穴の数だけくり抜きを並べる", () => {
    const clip = guideClipPath(THREE);

    // 各穴は「左上 → 左下 → 右下 → 右上 → 左上」の 5 点。3 穴で 15 点 + 外周の 5 点。
    expect(clip.match(/px/g)).toHaveLength(15 * 2);
    expect(clip.startsWith("polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ")).toBe(true);
  });

  it("穴を 1 つも持たないときは、画面全体を覆う（何も見せない）", () => {
    expect(guideClipPath([])).toBe("polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0)");
  });

  it("穴の並びをまとめた外接矩形を返す（吹き出しを並びに対して置く）", () => {
    expect(boundsOfHoles(THREE)).toEqual({ top: 100, left: 20, width: 350, height: 184 });
  });

  it("穴が無ければ null を返す", () => {
    expect(boundsOfHoles([])).toBeNull();
  });

  it("3 つの見出しを 1 つずつ囲むと、どの穴も画面の 6 割より小さく収まる", () => {
    const holes = THREE.map((rect) => clampHole(rect, PHONE));

    for (const hole of holes) {
      expect(hole.height).toBe(56 + 8 * 2);
      expect(hole.height).toBeLessThan(PHONE.height * GUIDE_HOLE_RATIO);
    }
  });
});

// 枚を進めるときの移動時間。黒い面を外して送るので、速すぎると何が起きたか
// 分からず、遅すぎると待たされる。距離に対して単調で、上下限に収まることだけ固定する。
describe("移動の速さ", () => {
  it("短い距離でも下限の時間をかける（一瞬で飛ばさない）", () => {
    expect(travelDuration(0)).toBe(GUIDE_TRAVEL_MIN_MS);
    expect(travelDuration(20)).toBeGreaterThanOrEqual(GUIDE_TRAVEL_MIN_MS);
  });

  it("距離が伸びるほど時間も伸びる", () => {
    expect(travelDuration(300)).toBeLessThan(travelDuration(700));
    expect(travelDuration(700)).toBeLessThan(travelDuration(1200));
  });

  it("距離が伸びても速さは上げない（1 秒あたりの移動を一定にする）", () => {
    const speed = (distance: number) => (distance / travelDuration(distance)) * 1000;

    // 下限に当たる短い距離より先は、どこまで行っても同じ速さ（丸めのぶんだけ許す）。
    for (const distance of [640, 900, 1200, 2000, 4000]) {
      expect(Math.abs(speed(distance) - speed(1200))).toBeLessThan(1);
    }
  });

  it("向き（上へ戻る）が変わっても同じ時間を使う", () => {
    expect(travelDuration(-500)).toBe(travelDuration(500));
  });

  it("速さはおよそ 600px/秒（目で追える）", () => {
    for (const distance of [400, 600, 800, 1600]) {
      const perSecond = (distance / travelDuration(distance)) * 1000;
      expect(perSecond).toBeGreaterThan(580);
      expect(perSecond).toBeLessThan(620);
    }
  });
});

// 遠い目的地も、時間を延ばして同じ速さで動かす。距離で速さを変えると、
// 遠い枚ほど「高速でスクロールした」と見える。
describe("遠い目的地への移動", () => {
  it("2,000px 先でも、速さは近い枚と変わらない", () => {
    const near = (600 / travelDuration(600)) * 1000;
    const far = (2000 / travelDuration(2000)) * 1000;

    expect(Math.abs(far - near)).toBeLessThan(1);
  });

  it("遠いほど時間は長くなる（一瞬で飛ばさない）", () => {
    expect(travelDuration(2000)).toBeGreaterThan(travelDuration(600));
    expect(travelDuration(2000)).toBeGreaterThan(1500);
  });
});

// 紙を出す前に、目的地が十分近づくまで送り直す。紙を出してから動かすと
// 「モーダルが出たのに画面が動く」ことになり、どこを見ればよいか分からなくなる。
describe("紙を出す前の送り直し", () => {
  it("160px 未満のずれは送らない（紙を出したままにする）", () => {
    expect(GUIDE_SETTLE_MIN_DISTANCE).toBeLessThan(320);
    expect(GUIDE_SETTLE_MIN_DISTANCE).toBeGreaterThan(GUIDE_TRAVEL_MIN_DISTANCE);
  });

  it("送り直しは 2 回まで（紙を出さないまま詰め切る）", () => {
    expect(GUIDE_SETTLE_COUNT).toBeGreaterThanOrEqual(1);
    expect(GUIDE_SETTLE_COUNT).toBeLessThanOrEqual(3);
  });
});

describe("押せる合図（手）", () => {
  const HOLE = { top: 275, left: 13, width: 464, height: 72 };

  it("見出しの文を隠さないよう、穴の右手前に置く", () => {
    const point = tapPoint(HOLE);

    expect(point.left).toBe(HOLE.left + HOLE.width - GUIDE_TAP_SIZE - GUIDE_TAP_INSET);
    expect(point.left).toBeGreaterThan(HOLE.left + HOLE.width / 2);
  });

  it("縦は穴の中央に合わせる（枠からはみ出さない）", () => {
    const point = tapPoint(HOLE);

    expect(point.top).toBe(HOLE.top + (HOLE.height - GUIDE_TAP_SIZE) / 2);
    expect(point.top).toBeGreaterThanOrEqual(HOLE.top);
    expect(point.top + GUIDE_TAP_SIZE).toBeLessThanOrEqual(HOLE.top + HOLE.height);
  });

  it("穴が手より狭いときも、穴の内側へ寄せる", () => {
    const narrow = { top: 100, left: 10, width: 28, height: 40 };
    const point = tapPoint(narrow);

    expect(point.left).toBe(narrow.left + GUIDE_TAP_INSET);
    expect(point.top).toBeGreaterThanOrEqual(narrow.top);
  });

  it("整数へ丸める（半端な位置で文字がにじまない）", () => {
    const point = tapPoint({ top: 10.4, left: 20.7, width: 101, height: 55 });

    for (const value of [point.top, point.left]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe("穴が複数あるときの吹き出しの基準", () => {
  const BUBBLE = { width: 352, height: 206 };
  const THREE = [
    { top: 275, left: 13, width: 464, height: 72 },
    { top: 343, left: 13, width: 464, height: 72 },
    { top: 411, left: 13, width: 464, height: 72 },
  ];

  it("穴が 1 つなら、その穴をそのまま基準にする", () => {
    const hole = { top: 100, left: 0, width: 390, height: 56 };

    expect(anchorForBubble([hole], PHONE, BUBBLE)).toEqual(hole);
  });

  it("まとめて置けるなら、並びの外接矩形を基準にする（穴ごとに紙が動かない）", () => {
    const anchor = anchorForBubble(THREE, { width: 504, height: 593 }, BUBBLE);

    expect(anchor).toEqual({ top: 275, left: 13, width: 464, height: 208 });
  });

  it("押して開き、並びが画面いっぱいに伸びたら、紙が重ならない穴を選ぶ", () => {
    // 実際に費用の見出しを押したときの位置（画面 504 × 593）。
    const stretched = [
      { top: 4, left: 13, width: 464, height: 72 },
      { top: 72, left: 13, width: 464, height: 72 },
      { top: 521, left: 13, width: 464, height: 72 },
    ];
    const viewport = { width: 504, height: 593 };
    const anchor = anchorForBubble(stretched, viewport, BUBBLE);
    const placement = placeBubble(anchor as GuideRect, viewport, BUBBLE);
    const overlaps = stretched.some((hole) => {
      const overlapX =
        placement.left < hole.left + hole.width && hole.left < placement.left + BUBBLE.width;
      const overlapY =
        placement.top < hole.top + hole.height && hole.top < placement.top + BUBBLE.height;
      return overlapX && overlapY;
    });

    expect(overlaps).toBe(false);
  });

  it("穴が無ければ null を返す", () => {
    expect(anchorForBubble([], PHONE, BUBBLE)).toBeNull();
  });
});
