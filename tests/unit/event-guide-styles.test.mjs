// 初回ガイド（スポットライトツアー）の見た目の契約。
//
// 直した見た目は 4 つ。どれも 1 行の指定が消えると元に戻る。
//   1. 黒い面と吹き出しは、最後の帯（40）より上・モーダル（50）より下に置く
//   2. 穴を塞ぐ透明な層を持つ（穴の中を押せない）
//   3. 押せる的は 40px、ボタンの文字は 15px を下回らない
//   4. 動きは `is-motion-off` のとき止める
//
// 画面を開かずに読むのは、390px の撮影（`npm run mock:sync`）を待たずに
// 重なりと押せる的を固定するため。段の決まりは style-breakpoints.test.mjs が見る。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** コメントを落としてから読む。`/* … *\/` が混ざるとセレクタの切り出しが崩れる。 */
function readStyles(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const ORGANIZER = readStyles("src/styles/screens/organizer.css");
const COMPONENTS = readStyles("src/styles/components.css");
/** 部品のソース。コメントを落として、1 行の指定が残っているかだけを見る。 */
const TOUR = readFileSync(
  path.join(ROOT, "src/modules/events/components/EventGuideTour.tsx"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** 指定したセレクタの宣言をすべてつなげて返す（同じセレクタが複数あれば全部）。 */
function declarations(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [];
  for (const match of source.matchAll(pattern)) bodies.push(match[1]);
  return bodies.join("\n");
}

/** `z-index` の数値。見つからなければ NaN。 */
function zIndex(source, selector) {
  const found = /z-index:\s*(\d+)/.exec(declarations(source, selector));
  return found ? Number(found[1]) : Number.NaN;
}

describe("ツアーの重なり", () => {
  it("黒い面は最後の帯より上、モーダルより下に置く", () => {
    const scrim = zIndex(ORGANIZER, ".guide-scrim");
    const bar = zIndex(COMPONENTS, ".form-final");
    const modal = zIndex(COMPONENTS, ".modal");

    expect(scrim).toBe(48);
    expect(bar).toBe(40);
    expect(modal).toBe(50);
    expect(scrim).toBeGreaterThan(bar);
    expect(scrim).toBeLessThan(modal);
  });

  it("吹き出しは黒い面より 1 段上に置く", () => {
    expect(zIndex(ORGANIZER, ".guide-bubble")).toBe(zIndex(ORGANIZER, ".guide-scrim") + 1);
  });

  it("穴の枠と塞ぐ層は黒い面と同じ高さに置く", () => {
    const scrim = zIndex(ORGANIZER, ".guide-scrim");

    expect(zIndex(ORGANIZER, ".guide-ring")).toBe(scrim);
    expect(zIndex(ORGANIZER, ".guide-blocker")).toBe(scrim);
  });

  it("1 枚目のために、地を塗らない黒い面を持つ（層は残して操作は止める）", () => {
    expect(declarations(ORGANIZER, ".guide-scrim--clear")).toContain("background: transparent");
  });
});

describe("穴を塞ぐ層", () => {
  it("位置を部品から渡せるよう固定で置く", () => {
    const body = declarations(ORGANIZER, ".guide-blocker");

    expect(body).toContain("position: fixed");
    expect(body).toContain("background: transparent");
  });

  it("枠は押せない（穴の内側だけを塞ぐ層へ指を通す）", () => {
    expect(declarations(ORGANIZER, ".guide-ring")).toContain("pointer-events: none");
  });
});

describe("押せる的と文字", () => {
  it("次へ・戻るのボタンは 40px の高さと 15px の文字を下回らない", () => {
    const body = declarations(ORGANIZER, ".guide-bubble__actions .btn");

    expect(body).toContain("min-height: var(--tap-target)");
    expect(body).toContain("font-size: var(--font-action)");
  });

  it("閉じる印も 40px の的を持つ", () => {
    const body = declarations(ORGANIZER, ".guide-bubble__close");

    expect(body).toContain("width: var(--tap-target)");
    expect(body).toContain("height: var(--tap-target)");
  });

  it("最終枚のチェックも 40px の的を持つ", () => {
    expect(declarations(ORGANIZER, ".guide-bubble__check")).toContain(
      "min-height: var(--tap-target)",
    );
  });

  it("見出しは 15px を下回らない", () => {
    expect(declarations(ORGANIZER, ".guide-bubble__title")).toContain("font-size: 1.0625rem");
  });
});

describe("紙の幅", () => {
  it("狭い端末でも横にはみ出さない幅で置く", () => {
    expect(declarations(ORGANIZER, ".guide-bubble")).toContain(
      "width: min(22rem, calc(100vw - 1.5rem))",
    );
  });

  it("広い画面では 640px の段でだけ広げる", () => {
    expect(ORGANIZER).toContain("@media (min-width: 640px)");
    expect(ORGANIZER).toContain("width: min(24rem, calc(100vw - 2rem))");
  });
});

describe("紙の縁", () => {
  it("朱の輪を常に出す（焦点の有無で枚ごとに見た目が変わらない）", () => {
    // 紙は開いた直後に 1 回だけ焦点を受ける。既定の `:focus-visible` に任せると
    // 1 枚目だけ縁が付き、2 枚目以降は縁の無い紙になる。
    const body = declarations(ORGANIZER, ".guide-bubble");

    expect(body).toContain("outline: 2px solid var(--color-primary)");
    expect(body).toContain("outline-offset: 2px");
  });
});

describe("動き", () => {
  it("動きを切ったときは止める", () => {
    expect(ORGANIZER).toContain(".deco:not(.is-motion-off) .guide-bubble");
  });
});

// 枚を進めるときは黒い面を外して移動を見せる。そのあいだ「触れない」ことを
// 赤い枠で示す。層が画面を覆っていること（押せないこと）まで固定する。
describe("移動中の赤い枠", () => {
  it("画面全体を覆う層として置く（移動中の押下を止める）", () => {
    const body = declarations(ORGANIZER, ".guide-travel");

    expect(body).toContain("position: fixed");
    expect(body).toContain("inset: 0");
    expect(body).toContain("touch-action: none");
  });

  it("地は塗らない（移動の様子を見せるため）", () => {
    expect(declarations(ORGANIZER, ".guide-travel")).not.toContain("background:");
    expect(declarations(ORGANIZER, ".guide-travel")).not.toContain("opacity:");
  });

  it("枠は朱の 2px で、画面の内側に引く", () => {
    const body = declarations(ORGANIZER, ".guide-travel::before");

    expect(body).toContain("border: 2px solid var(--color-primary)");
    expect(body).toContain("pointer-events: none");
  });

  it("何が起きているかを 1 行で添える", () => {
    expect(declarations(ORGANIZER, ".guide-travel__label")).toContain("pointer-events: none");
  });

  it("黒い面より上、モーダルより下に置く", () => {
    const travelZ = zIndex(ORGANIZER, ".guide-travel");

    expect(travelZ).toBe(zIndex(ORGANIZER, ".guide-scrim"));
    expect(travelZ).toBeLessThan(zIndex(COMPONENTS, ".modal"));
  });
});

// 押して確かめられる枚（2 枚目）だけ、穴を塞がずに手の合図を出す。
// 合図自体が押す邪魔になると、見出しを押せなくなる。
describe("押せる合図（手）", () => {
  it("穴の中身を押せるよう、合図は当たり判定を持たない", () => {
    const body = declarations(ORGANIZER, ".guide-tap");

    expect(body).toContain("position: fixed");
    expect(body).toContain("pointer-events: none");
  });

  it("紙と同じ段に置き、黒い面より手前へ出す", () => {
    expect(zIndex(ORGANIZER, ".guide-tap")).toBe(zIndex(ORGANIZER, ".guide-bubble"));
  });

  it("押してよい合図なので、朱とは別の緑で塗る", () => {
    expect(declarations(ORGANIZER, ".guide-tap")).toContain("color: var(--color-success-line)");
  });

  it("指先を軸に押す（押している場所が動いて見えない）", () => {
    const body = declarations(ORGANIZER, ".guide-tap__hand");

    expect(body).toContain("transform-origin: 48% 12%");
    expect(body).toContain("fill: currentColor");
  });

  it("押した瞬間の波を指先に合わせる", () => {
    const body = declarations(ORGANIZER, ".guide-tap__ripple");

    expect(body).toContain("border: 2px solid currentColor");
    expect(body).toContain("border-radius: 999px");
  });

  it("動きを切ったときは止める（ポータルは `.deco` の外に出るので `:has()` で見る）", () => {
    expect(ORGANIZER).toContain("body:has(.deco.is-motion-off) .guide-tap__hand");
    expect(ORGANIZER).toContain("@keyframes guide-tap-press");
    expect(ORGANIZER).toContain("@keyframes guide-tap-ripple");
  });
});

// 送りのスクロールは自前で計算する。`behavior: "auto"` で頼むと、`base.css` の
// `html { scroll-behavior: smooth }` に従ってブラウザのスムーススクロールに置き換わり、
// 送り終わりに溜まった分が一気に詰まって「紙の直前に急に速く」なる。
describe("スクロールの頼み方", () => {
  it("CSS のスムーススクロールに従わせない（`instant` でその場で合わせる）", () => {
    expect(TOUR).toContain('behavior: "instant"');
  });

  it("`auto` や `smooth` では頼まない（ブラウザの速さに任せない）", () => {
    expect(TOUR).not.toContain('behavior: "auto"');
    expect(TOUR).not.toContain('behavior: "smooth"');
    expect(TOUR).not.toContain("scrollBy");
  });

  it("毎フレームの指定は 1 か所（`jumpTo()`）にまとめる", () => {
    const calls = TOUR.match(/window\.scrollTo\(/g) ?? [];

    expect(calls).toHaveLength(1);
  });
});

// 止まった瞬間に黒くすると、着いた場所を見る間が無いまま紙に覆われる。
// 赤い枠だけの画面をしばらく置いてから、黒面と紙を同時に出す。
describe("止まってから紙を出すまで", () => {
  it("送り終わりに、紙を出さずに待つ", () => {
    expect(TOUR).toContain("GUIDE_REVEAL_HOLD_MS");
    expect(TOUR).toContain("setHolding(true)");
  });

  it("待っているあいだ、枠の 1 行を「移動しています」のままにしない", () => {
    expect(TOUR).toContain("使い方ガイド表示中");
  });

  it("待ちの残りを、右上の輪で数える", () => {
    expect(TOUR).toContain("GuideCount");
    expect(ORGANIZER).toContain("@keyframes guide-count");
    expect(declarations(ORGANIZER, ".guide-count")).toContain("position: absolute");
    // 長さは部品が渡す（2 秒と 3 秒を取り違えない）。
    expect(declarations(ORGANIZER, ".guide-count__bar")).toContain(
      "animation: guide-count var(--guide-count-ms",
    );
  });
});

// 1 枚目（挨拶）だけ地を塗らない。何の画面かを先に見せるため。
describe("1 枚目の黒い面", () => {
  it("地を塗らない面に差し替える（層は残す）", () => {
    expect(TOUR).toContain("guide-scrim--clear");
  });
});
