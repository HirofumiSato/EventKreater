// 画面の幅の段と、メディアクエリの向きを固定する。
//
// 参加者はスマホで開き、主催者の PC は従です（AGENTS.md「画面の組み方」）。
// 既定（メディアクエリの外）はスマホの見た目で、広い画面向けの差分だけを
// `min-width` で足します。ここが崩れると、PC を直すたびに `max-width` で
// スマホを打ち消す書き方が戻ってきます。
//
// 段を増やすときは、この表と src/styles/index.css の注記を同じ PR で直します。

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** 幅を持つ CSS を置く場所。共有スタイルと、Tailwind の入口。 */
const SCAN_DIRS = ["src/styles", "src/app"];

/** 広い画面へ広げる段。`min-width` はこの 4 つだけ。 */
const WIDEN = [640, 768, 900, 1024];

/** 狭い画面だけを詰める段。`max-width` はこの 4 つだけ。 */
const NARROW = [360, 400, 480, 540];

/** `max-width` に許す値。狭める段と、広げる段の 1px 手前（対になる書き方）。 */
const ALLOWED_MAX = new Set([...NARROW, ...WIDEN.map((width) => width - 1)]);

const WIDTH_CONDITION = /\((min|max)-width:\s*(\d+)px\)/g;

function cssFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...cssFiles(full));
    else if (entry.name.endsWith(".css")) found.push(full);
  }
  return found;
}

/** ファイルと行番号を添えた `@media` の一覧。 */
function mediaQueries(files) {
  const queries = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/@media\s*([^{]+)\{/g)) {
      queries.push({
        file: path.relative(ROOT, file).split(path.sep).join("/"),
        prelude: match[1].trim(),
        line: source.slice(0, match.index).split("\n").length,
        conditions: [...match[1].matchAll(WIDTH_CONDITION)].map(([, kind, value]) => ({
          kind,
          width: Number(value),
        })),
      });
    }
  }
  return queries;
}

const allQueries = mediaQueries(SCAN_DIRS.flatMap((dir) => cssFiles(path.join(ROOT, dir))));
const widthQueries = allQueries.filter((query) => query.conditions.length > 0);

describe("画面の幅の段", () => {
  it("走査する CSS がある", () => {
    expect(allQueries.length).toBeGreaterThan(0);
  });

  it("min-width は広げる段、max-width は狭める段か 1px 手前だけを使う", () => {
    const problems = [];
    for (const query of widthQueries) {
      for (const { kind, width } of query.conditions) {
        if (kind === "min" && !WIDEN.includes(width)) {
          problems.push(
            `${query.file}:${query.line} min-width: ${width}px は段にありません（${WIDEN.join(" / ")}）。` +
              "広い画面向けの差分はこの段で足してください。",
          );
        }
        if (kind === "max" && !ALLOWED_MAX.has(width)) {
          problems.push(
            `${query.file}:${query.line} max-width: ${width}px は段にありません（${NARROW.join(" / ")} か ` +
              `${WIDEN.map((value) => value - 1).join(" / ")}）。` +
              "狭い画面だけの詰めか、min-width の対にだけ使ってください。",
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("1 つの @media に min-width と max-width を混ぜない", () => {
    const problems = widthQueries
      .filter((query) => new Set(query.conditions.map(({ kind }) => kind)).size > 1)
      .map(
        (query) =>
          `${query.file}:${query.line} ${query.prelude} — 範囲指定は使わず、min-width の段を 1 つだけ指定してください。`,
      );
    expect(problems).toEqual([]);
  });

  it("幅の指定は px 付きの min-width / max-width で書く", () => {
    const problems = allQueries
      .filter((query) => /width/i.test(query.prelude) && query.conditions.length === 0)
      .map(
        (query) =>
          `${query.file}:${query.line} ${query.prelude} — (min-width: 640px) の形で書いてください。`,
      );
    expect(problems).toEqual([]);
  });
});
