// 復元の知らせ（Toast）と、スマホで画面下に固定される最後の帯（.form-final）の重なり。
//
// 直したのは 1 行。狭い画面では帯が画面下（`bottom: 0` / `z-index: 40`）に残り、
// 後から描画される知らせがその上を覆う。知らせは自動で消えないので、覆われた
// 「下書き保存」「プレビューに進む」は押せなくなる。
//   - 狭い画面では、知らせを帯の高さ（`--final-bar-h`）ぶん上へ逃がす
//   - iPhone のホームバーぶん（`safe-area-inset-bottom`）も足す
//   - 広い画面の `.toast`（右下）は変えない
//
// 画面を開かずに読むのは、390px の撮影を待たずに重なりを固定するため。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** コメントを落としてから読む。`/* … *\/` が混ざると宣言の切り出しが崩れる。 */
function readStyles(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 指定したセレクタの宣言をすべてつなげて返す（同じセレクタが複数あれば全部）。 */
function declarations(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [];
  for (const match of source.matchAll(pattern)) bodies.push(match[1]);
  return bodies.join("\n");
}

/** 指定したメディアクエリのブロックを、波括弧の対応を数えて切り出す。 */
function mediaBlocks(source, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`@media\\s*\\(\\s*${escaped}\\s*\\)\\s*\\{`, "g");
  const blocks = [];
  for (const match of source.matchAll(head)) {
    let depth = 0;
    const start = match.index + match[0].length - 1;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(source.slice(start + 1, index));
          break;
        }
      }
    }
  }
  return blocks;
}

const COMPONENTS = readStyles("src/styles/components.css");
const PUBLIC = readStyles("src/styles/screens/public.css");

const FINAL_TOAST = "body:has(.form-final) .toast";

/** 639px 以下のうち、最後の帯の知らせを書いたブロック。 */
function mobileFinalBlock() {
  const block = mediaBlocks(COMPONENTS, "max-width: 639px").find((body) =>
    body.includes(FINAL_TOAST),
  );

  expect(block, "639px 以下のブロックに body:has(.form-final) .toast が無い").toBeDefined();
  return block;
}

describe("復元の知らせと最後の帯", () => {
  it("帯がある画面では、知らせを帯の高さぶん上へ逃がす", () => {
    expect(declarations(mobileFinalBlock(), FINAL_TOAST)).toContain(
      "bottom: calc(var(--final-bar-h)",
    );
  });

  it("iPhone のホームバーぶんも足す", () => {
    expect(declarations(mobileFinalBlock(), FINAL_TOAST)).toContain(
      "env(safe-area-inset-bottom)",
    );
  });

  it("その指定は 639px 以下のメディアクエリの中にだけ置く（広い画面は変えない）", () => {
    const rule = "bottom: calc(var(--final-bar-h)";

    expect(mobileFinalBlock()).toContain(rule);
    expect(COMPONENTS.replace(mobileFinalBlock(), "")).not.toContain(rule);
  });

  it("帯が高くなる未ログインでも、同じ 1 行で足りる", () => {
    const mobile = mobileFinalBlock();

    // 未ログインの帯は 8.5rem。変数だけを見て、知らせ側に分岐を増やさない。
    expect(declarations(mobile, "body:has(.form-final--guest)")).toContain(
      "--final-bar-h: 8.5rem",
    );
    expect(declarations(mobile, "body:has(.form-final--guest) .toast")).toBe("");
  });
});

describe("広い画面の知らせ", () => {
  it("右下の置き方は今までどおり", () => {
    const body = declarations(PUBLIC, ".toast");

    expect(body).toContain("right: 1rem");
    expect(body).toContain("bottom: 1.25rem");
    expect(body).toContain("z-index: 40");
  });

  it("帯の高さを持ち込まない", () => {
    expect(declarations(PUBLIC, ".toast")).not.toContain("--final-bar-h");
  });
});
