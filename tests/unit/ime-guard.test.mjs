// 入力欄を持つ画面のキー操作が、日本語入力（IME）の変換確定・変換取り消しを
// 奪わないことを固定する。
//
// 変換確定の Enter と変換取り消しの Escape は、画面の操作ではなく IME の操作です。
// ここが崩れると、日本語入力中にステップが進む・ダイアログが閉じるといった形で
// 入力そのものが壊れます。正は docs/front_implementation_spec.md §1.4 と src/lib/ime.ts。
//
// 例外は持ちません。`keydown` を握るファイルが増えたら、そのファイルも必ず
// `@/lib/ime` を通してください。

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SRC = path.join(ROOT, "src");

// 走査の段で外すファイル。矢印キーだけで入力欄が無く、変換が起きない
// （計画で対象外にした 2 つ。増やすなら理由をここに書く）。
const OUT_OF_SCOPE = new Set([
  "src/app/HomeShowcase.tsx",
  "src/modules/organizers/components/ImageCropDialog.tsx",
]);

// 例外リストは空。`keydown` を握るファイルは 1 つ残らず IME のガードを通す。
const EXCEPTIONS = new Set();

/** `keydown` を握っているか。DOM のリスナーと React の属性の両方を見る。 */
const KEYDOWN = [/addEventListener\(\s*["']keydown["']/, /\bonKeyDown\s*=/];

/** `event.key === "Enter"` と `event.key !== "Escape"` の両方を拾う。 */
const KEY_COMPARE = /\bkey\s*!?==\s*["'](Enter|Escape)["']/g;

/** 改行をそろえて読む。 */
function read(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

/** `src/` 配下の `.ts` / `.tsx` をすべて返す。 */
function sources(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** 何行目か（1 始まり）。失敗したときに場所を示すためだけに使う。 */
function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/** その位置を含む `{ ... }` の範囲。ガードの効く分岐を取り出すのに使う。 */
function enclosingBlock(source, index) {
  const open = source.lastIndexOf("{", index);
  if (open === -1) return null;
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return { start: open, end: cursor };
    }
  }
  return null;
}

/** そのファイルが分岐で扱っているキー。 */
function handledKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(KEY_COMPARE)) keys.add(match[1]);
  return keys;
}

const files = sources(SRC).map((full) => ({
  file: path.relative(ROOT, full).split(path.sep).join("/"),
  source: readFileSync(full, "utf8").replace(/\r\n/g, "\n"),
}));

/** `keydown` を握るファイル。走査の段で対象外と例外を外す。 */
const keydownFiles = files.filter(
  ({ file, source }) =>
    !OUT_OF_SCOPE.has(file) &&
    !EXCEPTIONS.has(file) &&
    KEYDOWN.some((pattern) => pattern.test(source)),
);

describe("IME のキー操作ガード", () => {
  it("走査するファイルがある", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(keydownFiles.length).toBeGreaterThan(0);
  });

  it("例外は持たない", () => {
    // 計画で例外リストは空にすると決めた。増やすなら、なぜ IME のガードが要らないかを
    // ここに書いてから外す。
    expect([...EXCEPTIONS]).toEqual([]);
  });

  it("対象外にした 2 つは矢印キーだけで、keydown を持つ", () => {
    // 外し忘れ・外しすぎの検知。中身が keydown を持たなくなったら、この一覧から消す。
    for (const file of OUT_OF_SCOPE) {
      const source = read(file);
      expect(
        KEYDOWN.some((pattern) => pattern.test(source)),
        `${file} は keydown を持ちません。対象外の一覧を見直してください。`,
      ).toBe(true);
    }
  });

  it("keydown を握るファイルはすべて @/lib/ime を通す", () => {
    const missing = keydownFiles
      .filter(({ source }) => !/from\s+["']@\/lib\/ime["']/.test(source))
      .map(({ file }) => `${file} が @/lib/ime を import していません。`);
    expect(missing).toEqual([]);
  });

  it("Enter を扱うファイルは isImeEnter を通す", () => {
    const missing = keydownFiles
      .filter(({ source }) => handledKeys(source).has("Enter"))
      .filter(({ source }) => !source.includes("isImeEnter("))
      .map(({ file }) => `${file} が変換確定の Enter を isImeEnter で見ていません。`);
    expect(missing).toEqual([]);
  });

  it("Escape を扱うファイルは isImeEscape を通す", () => {
    const missing = keydownFiles
      .filter(({ source }) => handledKeys(source).has("Escape"))
      .filter(({ source }) => !source.includes("isImeEscape("))
      .map(({ file }) => `${file} が変換取り消しの Escape を isImeEscape で見ていません。`);
    expect(missing).toEqual([]);
  });

  it("ガードは対象の preventDefault より前に置く（同じ分岐の中で）", () => {
    // ガードの外にある無関係な preventDefault（ツアーの Tab など）は対象にしない。
    // ガードを含む `{ ... }` の中だけを見て、その中でガードより前の preventDefault を咎める。
    const problems = [];
    for (const { file, source } of keydownFiles) {
      for (const guard of ["isImeEnter(", "isImeEscape("]) {
        for (
          let index = source.indexOf(guard);
          index !== -1;
          index = source.indexOf(guard, index + guard.length)
        ) {
          const block = enclosingBlock(source, index);
          if (block === null || index > block.end) continue;
          const body = source.slice(block.start, block.end);
          for (const match of body.matchAll(/preventDefault\s*\(/g)) {
            const at = block.start + match.index;
            if (at < index) {
              problems.push(
                `${file}:${lineOf(source, index)} ${guard.slice(0, -1)} より前の ` +
                  `${lineOf(source, at)} 行目に preventDefault() があります。` +
                  "ガードを先に通してください。",
              );
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
