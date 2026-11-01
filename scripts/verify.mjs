// 検証を 1 コマンドに束ねる。PR を出す前の総仕上げ用。
//
//   npm run verify
//
// 手順は 2 段。
//
// 1. docs:gen の 4 本を順に走らせる。索引どうしに依存があるため、ここだけは直列にする
//    （llms.txt は doc-index.json を読み、traceability も同じ索引を使う）。
// 2. `check:full`・Sphinx・docs:links を同時に走らせる。書き込む先が違う
//    （node_modules/.cache・docs/_build・どこにも書かない）ので、重ねても壊さない。
//
// `docs:counts` は入れない。check:full が同じ Vitest の結果で件数を照合するため、
// ここで数え直すのは二度手間になる。
//
// 出力は scripts/check.mjs にそろえる。工程ごとに秒数を出し、失敗した工程の中身だけを
// 出す。並列のままだと 3 本の出力が混ざって読めないため。

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 1 工程を独立した子プロセスで走らせ、終了コード・出力・秒数を返す。 */
function run(label, script, args = []) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    let child;
    try {
      child = spawn(process.execPath, [path.join(root, script), ...args], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      resolve({ label, code: 1, output: `${label} を起動できません: ${error.message}`, seconds: 0 });
      return;
    }
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (error) => {
      resolve({ label, code: 1, output: String(error), seconds: 0 });
    });
    child.on("close", (code) => {
      resolve({
        label,
        code: code ?? 1,
        output: Buffer.concat(chunks).toString("utf8"),
        seconds: (Date.now() - started) / 1000,
      });
    });
  });
}

/** 終わった順に 1 行ずつ出す。並列でも、どの工程が遅いかが読める。 */
async function announce(promise) {
  const result = await promise;
  console.log(`${result.code === 0 ? "ok" : "NG"} ${result.label.padEnd(16)} ${result.seconds.toFixed(1)}s`);
  return result;
}

function showFailures(results) {
  for (const result of results) {
    console.log(`\n===== ${result.label} =====`);
    console.log(result.output.trimEnd());
  }
}

const started = Date.now();

// 1. 生成物を先に確定させる。順番そのものが依存。
const GEN = [
  ["gen:doc-index", "scripts/gen-doc-index.mjs"],
  ["gen:api-routes", "scripts/gen-api-routes.mjs"],
  ["gen:traceability", "scripts/gen-traceability.mjs"],
  ["gen:llms-txt", "scripts/gen-llms-txt.mjs"],
];

for (const [label, script] of GEN) {
  const result = await announce(run(label, script));
  if (result.code !== 0) {
    showFailures([result]);
    console.log("\ndocs:gen が失敗しました。生成物が揃わないので、並列の検証は実行していません。");
    process.exit(1);
  }
}

// 2. 互いに依存しない 3 本を同時に。
const results = await Promise.all(
  [
    run("check:full", "scripts/check.mjs", ["--full"]),
    run("docs", "scripts/build-docs.mjs"),
    run("docs:links", "scripts/check-doc-links.mjs"),
  ].map(announce),
);

const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
  showFailures(failed);
  console.log(`\n${failed.map((result) => result.label).join(", ")} が失敗しました。`);
  process.exit(1);
}

console.log(`\nすべて通りました（${((Date.now() - started) / 1000).toFixed(1)}s）`);
