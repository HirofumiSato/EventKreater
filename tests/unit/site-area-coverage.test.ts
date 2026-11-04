// 画面の領域の分類漏れを、実在する page.tsx を走査して検出する。
//
// `viewerArea()` はヘッダーの並び・札・メニューが共通で読む。新しい画面を足して
// 分類を忘れると、その画面だけ参加者の並びに落ちる（主催者の画面なのに、など）。
// `src/app` 配下の page.tsx をすべて集め、ヘッダーを出す画面が
// `unclassified` にならないことを固定する。ブラウザも DB も使わない。

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { siteChrome } from "@/lib/site-chrome";
import { viewerArea } from "@/lib/site-nav";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const APP_DIR = path.join(ROOT, "src", "app");

/** 動的セグメント（`[id]`）を置き換える見本。 */
const SAMPLE_SEGMENT = "sample";

/** 動的セグメントを URL として開ける形にする。`[id]`・`[...rest]` のどちらも受ける。 */
function toSampleSegment(segment: string): string {
  return segment.startsWith("[") && segment.endsWith("]") ? SAMPLE_SEGMENT : segment;
}

/**
 * `src/app` 配下の page.tsx を集め、URL のパスへ直す。
 *
 * `readdirSync` の `recursive` は使わず、ディレクトリだけを自前で降りる。
 * page.tsx を持つディレクトリがそのまま 1 画面になる（`src/app/page.tsx` は `/`）。
 */
function collectRoutes(dir: string): string[] {
  const routes: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      routes.push(...collectRoutes(full));
      continue;
    }
    if (entry.name !== "page.tsx") continue;

    // `src/app` からの相対パスが、そのまま画面のパスになる。
    const segments = path
      .relative(APP_DIR, dir)
      .split(path.sep)
      .filter((segment) => segment !== "" && segment !== ".")
      .map(toSampleSegment);
    routes.push(segments.length === 0 ? "/" : `/${segments.join("/")}`);
  }

  return routes.sort();
}

const routes = collectRoutes(APP_DIR);

/** 共通ヘッダーを出す画面だけが対象。ヘッダーを出さない画面は `none` で分類済み。 */
const headerRoutes = routes.filter((route) => siteChrome(route).header);

describe("画面の領域の分類", () => {
  it("src/app の page.tsx を 1 件以上集める", () => {
    // 走査が空のまま緑にならないよう、代表の画面が入っていることも見る。
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toContain("/");
    expect(routes).toContain("/participant");
    expect(routes).toContain("/account/email/verify");
    // 動的セグメントは sample に置き換える（URL として開ける形にする）。
    expect(routes).toContain("/organizers/sample/events");
    expect(routes).toContain("/organizer/events/sample/edit");
  });

  it("ヘッダーを出すすべての画面が、どこかの領域に分類されている", () => {
    const unclassified = headerRoutes.filter((route) => viewerArea(route) === "unclassified");

    // どの画面が未分類か分かるよう、配列で示す。
    expect(unclassified).toEqual([]);
  });

  it("代表的な画面の領域を取り違えない", () => {
    // 主催者と参加者が同じ画面を使う共有領域。
    expect(viewerArea("/account")).toBe("shared");
    expect(viewerArea("/account/email/verify")).toBe("shared");
    expect(viewerArea("/mypage")).toBe("organizer");
    expect(viewerArea("/participant")).toBe("participant");
    expect(viewerArea("/service")).toBe("public");
    expect(viewerArea("/console")).toBe("admin");
  });
});
