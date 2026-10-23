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

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 依存パッケージの実行用 JS の入口を、cwd 非依存で解決する。 */
function entry(specifier) {
  return fileURLToPath(import.meta.resolve(specifier));
}

const TASKS = [
  { label: "lint", module: "next/dist/bin/next", args: ["lint"] },
  { label: "typecheck", module: "typescript/bin/tsc", args: ["--noEmit"] },
  { label: "test", module: "vitest/vitest.mjs", args: ["run"] },
];

function run(task) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    let child;
    try {
      const script = entry(task.module);
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

console.log(`\nすべて通りました（${((Date.now() - started) / 1000).toFixed(1)}s）`);
