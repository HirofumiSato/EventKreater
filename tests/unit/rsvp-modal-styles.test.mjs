// 出欠の層の見た目の契約。
//
// 直した見た目は 4 つで、どれも 1 行の指定が消えると元に戻る。
//   1. 性別の札は 44px まで詰める（72px だと層が伸びる）
//   2. 日時は 3 件まで横に並べる
//   3. 選べない札は消さずにグレーにする
//   4. 層の本文の右に余白を取り、スクロールバーで枠が見切れないようにする
//
// 画面を開かずに読むのは、390px の撮影（`npm run mock:sync`）を待たずに
// 崩れの原因になった 1 行を固定するため。段の決まりは style-breakpoints.test.mjs が見る。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** コメントを落としてから読む。`/* … *\/` が混ざるとセレクタの切り出しが崩れる。 */
function readStyles(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const COMPONENTS = readStyles("src/styles/components.css");
const SURFACE = readStyles("src/styles/deco/surface.css");

/**
 * 指定したセレクタを持つ宣言だけを取り出す。
 * `.a,\n.b { … }` のような並記でも拾えるよう、セレクタは 1 つずつに割って比べる。
 */
function declarations(source, selector) {
  const bodies = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((row) => row.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies.join("\n");
}

describe("性別の札", () => {
  it("2 択を 1 段に並べる", () => {
    expect(declarations(COMPONENTS, ".choice-group--compact")).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
    );
  });

  it("押せる的の下限（44px）まで詰める", () => {
    const body = declarations(COMPONENTS, ".choice-group--compact .choice");
    expect(body).toContain("min-height: var(--tap-target)");
    // 札の文字は 15px を下回らせない（AGENTS.md「画面の組み方」）。
    expect(body).toContain("font-size: var(--font-action)");
  });
});

describe("出席する日時の札", () => {
  it("3 件まで横に並べ、狭ければ折り返す", () => {
    const body = declarations(COMPONENTS, ".choice-group--schedule");
    expect(body).toContain("repeat(auto-fit, minmax(5rem, 1fr))");
  });

  it("日付と時刻の 2 段でも、押せる的は 44px を下回らない", () => {
    expect(declarations(COMPONENTS, ".choice--schedule")).toContain(
      "min-height: var(--tap-target)",
    );
  });
});

describe("選べない札", () => {
  it("消さずにグレーにし、押せないと分かる見た目にする", () => {
    const body = declarations(COMPONENTS, ".choice:has(input:disabled)");
    expect(body).toContain("opacity:");
    expect(body).toContain("cursor: not-allowed");
    expect(body).toContain("background: var(--color-slate-100)");
  });

  it("欄の見出しと注記も落とす（入力そのものは残す）", () => {
    const body = declarations(COMPONENTS, ".field--disabled > .label");
    expect(body).toContain("color: var(--color-text-subtle)");
  });
});

describe("層の本文とスクロールバー", () => {
  it("右に余白を取り、バーの幅を先に確保する", () => {
    const body = declarations(COMPONENTS, ".modal--sheet .dialog > form");
    expect(body).toContain("padding-inline-end: 0.75rem");
    expect(body).toContain("scrollbar-gutter: stable");
  });
});

describe("ログイン中の 1 行", () => {
  it("切り替えのリンクを持たない", () => {
    expect(declarations(SURFACE, ".rsvp__member a")).toBe("");
  });
});
