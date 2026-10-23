// PR の変更ファイルから、CI で走らせるジョブを決める。
//
//   node scripts/ci-scope.mjs
//
// GITHUB_OUTPUT に code と flyer の真偽値を書く。`.github/workflows/ci.yml` の
// changes ジョブがこれを呼び、後続のジョブが step の `if:` で参照する。
//
// 判定は保守的にする。判定を誤ると、触っていない領域の破壊を見逃す。
// 規則そのものは tests/unit/ci-scope.test.mjs に仕様として書いてある。

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 変更されたファイルのパス一覧から、走らせるジョブを決める。
 *
 * `code` は check と db、`flyer` は flyer（pytest と mypy）に対応する。
 * 一覧が空のときは、取得に失敗した場合と区別できないので両方 true に倒す。
 *
 * @param {readonly string[]} files リポジトリ直下からの相対パス（posix）。
 * @returns {{ code: boolean, flyer: boolean }}
 */
export function classifyChanges(files) {
  let code = false;
  let flyer = false;
  let counted = 0;

  for (const file of files) {
    if (!file) continue;
    counted += 1;

    // リポジトリ直下の .md は文書だけ。`*.md` を接頭辞で見ると
    // src/ 配下の .md まで巻き込むので、スラッシュの有無で直下に限定する。
    if (!file.includes("/") && file.endsWith(".md")) continue;

    if (file.startsWith("services/flyer/")) {
      flyer = true;
      continue;
    }
    if (file.startsWith("docs/") || file === "llms.txt") continue;

    // ワークフローを変えたら、どのジョブが壊れたか分からないので全部走らせる。
    if (file.startsWith(".github/workflows/")) {
      code = true;
      flyer = true;
      continue;
    }

    code = true;
  }

  if (counted === 0) return { code: true, flyer: true };
  return { code, flyer };
}

/** PR の変更ファイル一覧を GitHub API から取る。取れなければ空を返す。 */
export function fetchChangedFiles({ repository, pullNumber, run = execFileSync }) {
  const output = run(
    "gh",
    [
      "api",
      `repos/${repository}/pulls/${pullNumber}/files?per_page=100`,
      "--paginate",
      "--jq",
      ".[] | .filename, (.previous_filename // empty)",
    ],
    { encoding: "utf8" },
  );
  return output.split("\n").filter((line) => line !== "");
}

function writeOutputs(scope) {
  const body = `code=${scope.code}\nflyer=${scope.flyer}\n`;
  const target = process.env.GITHUB_OUTPUT;
  if (target) {
    appendFileSync(target, body, "utf8");
    return;
  }
  process.stdout.write(body);
}

function main() {
  const pullNumber = process.env.PR_NUMBER ?? "";
  if (pullNumber === "") {
    // main への push は PR ではない。main は常に全部緑にしておく。
    writeOutputs({ code: true, flyer: true });
    return;
  }

  let files;
  try {
    files = fetchChangedFiles({
      repository: process.env.GITHUB_REPOSITORY ?? "",
      pullNumber,
    });
  } catch (error) {
    // 取れないまま絞ると、見ていない領域を緑にしてしまう。全部走らせる。
    process.stderr.write(`変更ファイルを取れませんでした。全部走らせます: ${error.message}\n`);
    files = [];
  }

  const scope = classifyChanges(files);
  console.log(`変更 ${files.length} 件 -> code=${scope.code} flyer=${scope.flyer}`);
  writeOutputs(scope);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
