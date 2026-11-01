// 生成物を「中身が変わったときだけ書く」ことの仕様。
//
// scripts/lib/write-if-changed.mjs を直接読み込む。ブラウザも DB も使わない。
// ここが壊れると、内容が同じでも mtime が動き、Sphinx の増分ビルドが毎回 4 ページを
// 作り直す（`npm run verify` が遅くなる）。その退行を 1 か所で止める。

import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFileIfChanged, writeFileIfChangedSync } from "../../scripts/lib/write-if-changed.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "write-if-changed-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** mtime の分解能に頼らず差が出るよう、書き込みの前に少しだけ待つ。 */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("writeFileIfChanged", () => {
  it("ファイルが無ければ書いて true を返す", async () => {
    const file = path.join(dir, "out.txt");
    await expect(writeFileIfChanged(file, "あ\n")).resolves.toBe(true);
    expect(readFileSync(file, "utf8")).toBe("あ\n");
  });

  it("中身が同じなら書かずに false を返し、mtime も動かさない", async () => {
    const file = path.join(dir, "out.txt");
    await writeFileIfChanged(file, "同じ中身\n");
    const before = statSync(file).mtimeMs;

    await tick();
    await expect(writeFileIfChanged(file, "同じ中身\n")).resolves.toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it("中身が違えば書き換えて true を返す", async () => {
    const file = path.join(dir, "out.txt");
    await writeFileIfChanged(file, "旧\n");

    await expect(writeFileIfChanged(file, "新\n")).resolves.toBe(true);
    expect(readFileSync(file, "utf8")).toBe("新\n");
  });
});

describe("writeFileIfChangedSync", () => {
  it("生成スクリプトから同じ規則で使える", () => {
    const file = path.join(dir, "index.json");
    expect(writeFileIfChangedSync(file, "{}\n")).toBe(true);
    expect(writeFileIfChangedSync(file, "{}\n")).toBe(false);
    expect(writeFileIfChangedSync(file, "{}\n\n")).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("{}\n\n");
  });
});
