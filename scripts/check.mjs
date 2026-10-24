// lint・型検査・テストを並列で走らせる。
//
//   npm run check
//
// 逐次だと 3 つの合計時間がそのまま待ち時間になる。互いに依存しないので同時に走らせ、
// 全部終わってから結果をまとめて出す。落ちたものが複数あっても 1 回で分かる。
//
// npm run を 3 回呼ばず、各ツールの JS を直接 node で起動する。npm の起動だけで
// 1 回あたり数秒かかり、その待ちは検査そのものより長いことがあるため。
//
// 出力は各タスクごとに溜め、失敗したときだけ中身を出す。並列のままだと 3 つの
// 出力が混ざって読めない。
//
// Vitest には json レポータも付ける。docs に書いたテスト件数が実測と合っているかを、
// 同じ 1 回の実行で確かめるため（scripts/gen-test-counts.mjs）。件数は生成物なので、
// 原稿を直し忘れたらここで止まる。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { byFile, inspect, scopePath } from "./gen-test-counts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestReport = path.join(os.tmpdir(), `event-creater-check-${process.pid}.json`);

/** 依存パッケージの実行用 JS の入口を、cwd 非依存で解決する。 */
function entry(specifier) {
  return fileURLToPath(import.meta.resolve(specifier));
}

const TASKS = [
  { label: "lint", module: "next/dist/bin/next", args: ["lint"] },
  { label: "typecheck", module: "typescript/bin/tsc", args: ["--noEmit"] },
  {
    label: "test",
    module: "vitest/vitest.mjs",
    args: ["run", "--reporter=default", "--reporter=json", `--outputFile.json=${vitestReport}`],
  },
  // リポジトリ内のスクリプトは import.meta.resolve を通さず、パスで直接起動する。
  { label: "ui-map", script: "scripts/check-ui-map.mjs", args: [] },
  { label: "ui-css", script: "scripts/check-ui-css.mjs", args: [] },
];

function run(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    let child;
    try {
      const script = task.script ? path.join(root, task.script) : entry(task.module);
      child = spawn(process.execPath, [script, ...task.args], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      resolve({ ...task, code: 1, output: `${task.label} を起動できません: ${error.message}`, seconds: 0 });
      return;
    }
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (error) => {
      resolve({ ...task, code: 1, output: String(error), seconds: 0 });
    });
    child.on("close", (code) => {
      resolve({
        ...task,
        code: code ?? 1,
        output: Buffer.concat(chunks).toString("utf8"),
        seconds: (Date.now() - started) / 1000,
      });
    });
  });
}

/** docs に書いた件数が、いまのテストと合っているか。 */
function checkDocCounts() {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(vitestReport, "utf8"));
  } catch {
    return { ok: true, note: "テストの結果を読めなかったので、件数の照合は省きます" };
  } finally {
    fs.rmSync(vitestReport, { force: true });
  }

  const inspected = inspect(fs.readFileSync(scopePath, "utf8"), byFile(report));
  const { all, unit, integration } = inspected.totals;
  const note = `テスト ${all.files} ファイル ${all.tests} 件（unit ${unit.tests}、結合 ${integration.tests}）`;
  if (!inspected.paragraphs && inspected.stale.length === 0) return { ok: true, note };

  const lines = [
    "docs/testing/scope.rst の件数が実測と合っていません。",
    "npm run docs:counts で書き戻してから、もう一度 npm run check を実行してください。",
    ...inspected.stale.map((line) => `  ${line}`),
  ];
  return { ok: false, note, output: lines.join("\n") };
}

const started = Date.now();
const results = await Promise.all(TASKS.map(run));

for (const result of results) {
  const status = result.code === 0 ? "ok" : "NG";
  console.log(`${status.padEnd(2)} ${result.label.padEnd(10)} ${result.seconds.toFixed(1)}s`);
}

const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
  for (const result of failed) {
    console.log(`\n===== ${result.label} =====`);
    console.log(result.output.trimEnd());
  }
  console.log(`\n${failed.map((result) => result.label).join(", ")} が失敗しました。`);
  process.exit(1);
}

// テストが落ちているときは件数を見ても意味がないので、通ったときだけ照合する。
const docs = checkDocCounts();
console.log(`${docs.ok ? "ok" : "NG"} ${"docs-count".padEnd(10)} ${docs.note}`);
if (!docs.ok) {
  console.log(`\n===== docs-count =====`);
  console.log(docs.output);
  console.log("\ndocs-count が失敗しました。");
  process.exit(1);
}

console.log(`\nすべて通りました（${((Date.now() - started) / 1000).toFixed(1)}s）`);
