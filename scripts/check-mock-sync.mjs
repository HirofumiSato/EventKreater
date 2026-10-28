// モックが製品のソースと同期しているかを、ブラウザを使わずに確かめる。
//
//   npm run check        … scripts/check.mjs から呼ばれる（1 秒未満）
//   npm run mock:check   … これだけを実行する
//
// 見るのは 3 つ。どれもハッシュとファイルの有無だけで、DB もブラウザも要らない。
//
//   1. 画面の見た目を決めるソースの指紋が、最後に `mock:sync` したときと同じか
//   2. 目録にある画面の HTML がそろっているか
//   3. 書き出した HTML が、manifest に記録した内容のままか（手で直していないか）
//
// 非常時は `MOCK_SYNC_ALLOW_STALE=1` で通せる。使ったら PR に理由を書く。

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { computeUiHash, normalizeNewlines } from "./lib/mock-hash.mjs";
import { expectedFiles } from "./lib/mock-screens.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_DIR = path.join(ROOT, "style-guide");
const MANIFEST = path.join(STYLE_DIR, "mock-manifest.json");

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** 目録とは別に、毎回そろっていなければならない生成物。 */
export const TOOL_FILES = [
  "mock-index.html",
  "mock-frame.html",
  "mock-shell.js",
  "mock-shell.css",
  "mock-interactions.js",
  "mock-guide.css",
];

/**
 * 各モックに「モックだけの帯」が入っているか。
 *
 * 帯は製品の DOM に無いので、`withMockShell` を通さずに書き出すと消える。
 * 消えたことに気づかないままコミットしないよう、ここで止める。
 */
export function missingShell(names, contents) {
  const problems = [];
  for (const name of names) {
    const html = contents.get(name);
    // ファイルごと無い場合は evaluateSync が言う。ここでは二重に出さない。
    if (html === undefined) continue;
    if (html.includes("data-mock-shell")) continue;
    problems.push(
      `style-guide/${name} にモックの帯がありません。\`npm run mock:sync\` を実行してください。`,
    );
  }
  return problems;
}

/**
 * 各モックに「モック専用の操作」が入っているか。
 *
 * 帯と同じで、`withMockInteractions` を通さずに書き出すと消える。消えると
 * カレンダーの日付も音声入力も動かないまま（見た目は同じなので）気づきにくい。
 */
export function missingInteractions(names, contents) {
  const problems = [];
  for (const name of names) {
    const html = contents.get(name);
    if (html === undefined) continue;
    if (html.includes("mock-interactions.js")) continue;
    problems.push(
      `style-guide/${name} に操作の script がありません。\`npm run mock:sync\` を実行してください。`,
    );
  }
  return problems;
}

/**
 * 同期しているかを判定する。ブラウザもファイルも触らない純ロジック（テスト対象）。
 *
 * @param {object|null} manifest  `style-guide/mock-manifest.json` の中身
 * @param {string[]} expected     目録が期待するファイル名
 * @param {string} uiHash         いまの UI ソースの指紋
 * @param {Map<string, string|null>} fileHashes  書き出した HTML の指紋（無ければ null）
 * @param {string[]} tools        一覧・枠など、目録の外にある生成物
 */
export function evaluateSync({
  manifest,
  expected,
  uiHash,
  fileHashes,
  extraFiles = [],
  tools = [],
}) {
  const problems = [];

  if (!manifest) {
    problems.push(
      "style-guide/mock-manifest.json がありません。`npm run mock:sync` を一度実行してください。",
    );
    return problems;
  }

  if (manifest.uiHash !== uiHash) {
    problems.push(
      "画面のソースが、最後にモックを書き出したときから変わっています。`npm run mock:sync` を実行してください。",
    );
  }

  const entries = new Map((manifest.screens ?? []).map((entry) => [entry.file, entry]));
  for (const file of expected) {
    const entry = entries.get(file);
    if (!entry) {
      problems.push(`style-guide/${file} が manifest にありません。`);
      continue;
    }
    const actual = fileHashes.get(file) ?? null;
    if (actual === null) {
      problems.push(`style-guide/${file} がありません。`);
    } else if (actual !== entry.hash) {
      problems.push(`style-guide/${file} が manifest の内容と違います（手で編集していませんか）。`);
    }
  }

  const known = new Set(expected);
  for (const name of tools) {
    if (!fileHashes.get(name)) {
      problems.push(`style-guide/${name} がありません。\`npm run mock:sync\` を実行してください。`);
    }
  }

  for (const name of extraFiles) {
    if (!/^mock-.*\.html$/.test(name)) continue;
    if (name === "mock-index.html" || name === "mock-frame.html") continue;
    if (known.has(name)) continue;
    problems.push(`style-guide/${name} は目録にありません（消し忘れ）。`);
  }

  return problems;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    return null;
  }
}

function hashOf(buffer) {
  return buffer ? sha256(normalizeNewlines(buffer)) : null;
}

async function readBytes(file) {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

export async function collect() {
  const manifest = await readManifest();
  const expected = expectedFiles();
  const fileHashes = new Map();
  const contents = new Map();
  for (const file of [...expected, ...TOOL_FILES]) {
    const buffer = await readBytes(path.join(STYLE_DIR, file));
    fileHashes.set(file, hashOf(buffer));
    if (buffer && file.endsWith(".html")) contents.set(file, buffer.toString("utf8"));
  }
  const extraFiles = await readdir(STYLE_DIR).catch(() => []);
  return {
    problems: [
      ...evaluateSync({
        manifest,
        expected,
        uiHash: computeUiHash(ROOT),
        fileHashes,
        extraFiles,
        tools: TOOL_FILES,
      }),
      ...missingShell(expected, contents),
      ...missingInteractions(expected, contents),
    ],
    expected,
  };
}

async function main() {
  const { problems, expected } = await collect();

  if (problems.length === 0) {
    console.log(`モック ${expected.length} 枚は製品のソースと同期しています。`);
    return;
  }

  if (process.env.MOCK_SYNC_ALLOW_STALE === "1") {
    console.log("モックが同期していませんが、MOCK_SYNC_ALLOW_STALE=1 のため通します。");
    for (const problem of problems) console.log(`  ${problem}`);
    console.log("PR には、なぜ同期せずに通したかを書いてください。");
    return;
  }

  console.error("モックが製品のソースと同期していません。");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\n`npm run mock:sync` を実行し、生成された style-guide/mock-*.html をコミットしてください。",
  );
  process.exit(1);
}

// CLI として起動されたときだけ走らせる（テストからは collect だけを使う）。
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
