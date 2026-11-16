// 書体と見本画像の先読みを止めていることを固定する。
//
// 日本語の書体は 1 ウェイトが 70 前後のサブセットに分かれる。next/font の既定は
// それを全件 preload するので、実配信では 359 本（4.8MB）を描画前に取りに行き、
// LCP が帯域待ちになっていました。ホームの見本画像 6 枚（1.3MB）も同じ理由で
// 先読みさせません。`loading="lazy"` の <img> には Next の image preload が出ない
// ことを `/sample` で確かめてあります。
//
// ここが戻ると、画面上は何も変わらないまま初期表示だけが重くなります。
// ウェイトはテーマが前提にしている（400/500/700・500/700）ので減らしません。
// 理由は docs/front_implementation_spec.md（14.4 のテーマ）に書いています。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const LAYOUT = path.join(ROOT, "src/app/layout.tsx");
const SHOWCASE = path.join(ROOT, "src/app/HomeShowcase.tsx");

/** `next/font/google` の宣言を、書体名と中身に分ける。 */
function fontDeclarations(source) {
  const declarations = [];
  for (const [, name, body] of source.matchAll(
    /(Zen_Kaku_Gothic_New|Zen_Maru_Gothic)\(\{([\s\S]*?)\n\}\);/g,
  )) {
    declarations.push({ name, body });
  }
  return declarations;
}

/** 宣言の中の `weight: [...]` を、数えやすい配列にする。 */
function weights(body) {
  const match = body.match(/weight:\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"(\d+)"/g)].map(([, weight]) => weight);
}

const layoutSource = readFileSync(LAYOUT, "utf8");
const showcaseSource = readFileSync(SHOWCASE, "utf8");
const declarations = fontDeclarations(layoutSource);

describe("書体と見本画像の先読み", () => {
  it("base の 2 つの書体は preload: false を持ち、ウェイトは減らさない", () => {
    expect(declarations.map(({ name }) => name)).toEqual([
      "Zen_Kaku_Gothic_New",
      "Zen_Maru_Gothic",
    ]);

    const problems = [];
    for (const { name, body } of declarations) {
      if (!/preload:\s*false/.test(body)) {
        problems.push(
          `${name} に preload: false がありません。日本語のサブセットを全件先読みすると、` +
            "初期表示の帯域を書体が埋めて LCP が遅れます。",
        );
      }
    }
    expect(problems).toEqual([]);

    // テーマ側（docs/ui-review/theme-review.md）が前提にしているウェイト。
    expect(weights(declarations[0].body)).toEqual(["400", "500", "700"]);
    expect(weights(declarations[1].body)).toEqual(["500", "700"]);
  });

  it("見本の <img> は loading=\"lazy\" で読む", () => {
    const images = [...showcaseSource.matchAll(/<img\b[\s\S]*?\/>/g)].map(([tag]) => tag);
    expect(images.length).toBeGreaterThan(0);

    const problems = [];
    for (const tag of images) {
      const line = showcaseSource.slice(0, showcaseSource.indexOf(tag)).split("\n").length;
      if (!/loading="lazy"/.test(tag)) {
        problems.push(
          `HomeShowcase.tsx:${line} の <img> に loading="lazy" がありません。` +
            "見本 6 枚が image preload として初期表示の帯域を埋めます。",
        );
      }
      if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
        problems.push(
          `HomeShowcase.tsx:${line} の <img> に width / height がありません。` +
            "遅延読み込みにすると、場所を確保しないぶん CLS が出ます。",
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
