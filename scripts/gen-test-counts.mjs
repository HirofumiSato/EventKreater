// テストの件数を docs に書き戻す。
//
//   npm run docs:counts            Vitest を走らせて書き戻す
//   npm run docs:counts -- --check 書き戻さず、ずれていたら終了コード 1
//   node scripts/gen-test-counts.mjs --from=<report.json>  既存の結果を使う
//
// 件数を手で書くと、テストを足すたびに各ページの数字がずれる。実際にずれていた。
// そこで件数は生成物として扱い、原稿には説明だけを残す。正を持つのは
// ``docs/testing/scope.rst`` の 1 か所だけ。
//
// 数えるのは Vitest の json レポータ。``vitest list`` は skip される結合テストを
// 一覧に載せないので使わない（``TEST_DATABASE_URL`` の無い環境では 0 件になる）。
//
// 置き換えるのは次の 2 か所。
//
// * ``count-start`` / ``count-end`` に挟まれた段落
// * 表の、ファイル名の次の行にある件数
//
// ``scripts/check.mjs`` は、自分が走らせた Vitest の結果を ``--from`` で渡して
// ``--check`` する。テストをもう一度走らせずに、ずれをその場で止められる。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const scopePath = path.join(root, "docs", "testing", "scope.rst");

export function runVitest() {
  const reportPath = path.join(os.tmpdir(), `event-creater-vitest-${process.pid}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--reporter=json",
        `--outputFile=${reportPath}`,
      ],
      { cwd: root, stdio: "ignore", env: process.env },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      const report = readReport(reportPath);
      fs.rmSync(reportPath, { force: true });
      if (!report) {
        reject(new Error("Vitest の結果を読めません"));
        return;
      }
      // 落ちていても件数は数えられる。落ちたこと自体は呼び出し元へ伝える。
      resolve({ report, failed: code !== 0 });
    });
  });
}

function readReport(reportPath) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    return null;
  }
}

/** レポートを「リポジトリからの相対パス → 件数」に均す。 */
export function byFile(report) {
  const counts = new Map();
  for (const result of report.testResults) {
    const relative = path.relative(root, result.name).split(path.sep).join("/");
    counts.set(relative, result.assertionResults.length);
  }
  return counts;
}

export function totals(counts) {
  const sum = (prefix) => {
    let files = 0;
    let tests = 0;
    for (const [file, count] of counts) {
      if (!file.startsWith(prefix)) continue;
      files += 1;
      tests += count;
    }
    return { files, tests };
  };
  return { unit: sum("tests/unit/"), integration: sum("tests/integration/"), all: sum("tests/") };
}

function blockPattern(name) {
  return new RegExp(`(\\.\\. ${name}-start\\r?\\n\\r?\\n)([\\s\\S]*?)(\\r?\\n\\r?\\n\\.\\. ${name}-end)`);
}

function extractBlock(source, name) {
  const match = blockPattern(name).exec(source);
  if (!match) throw new Error(`${name}-start / ${name}-end が docs/testing/scope.rst にありません`);
  return match[2];
}

function replaceBlock(source, name, body) {
  return source.replace(blockPattern(name), `$1${body}$3`);
}

/** 原稿を実際の件数に合わせる。書き換えた本文と、直した差分を返す。 */
export function applyCounts(source, counts) {
  const { unit, integration, all } = totals(counts);

  const summary =
    `${all.files} ファイル、\`\`it\`\` は ${all.tests} 件です。` +
    `内訳は \`\`tests/unit/\`\` が ${unit.files} ファイル ${unit.tests} 件、` +
    `\`\`tests/integration/\`\` が ${integration.files} ファイル ${integration.tests} 件です。` +
    `結合の ${integration.tests} 件は \`\`TEST_DATABASE_URL\`\` があるときだけ走ります。` +
    `すべて Stripe も OpenAI も呼びません。表はすべてのファイルを並べたものです。`;

  const breakdown =
    `件数の内訳は \`\`tests/unit/\`\` が ${unit.tests}、\`\`tests/integration/\`\` が ${integration.tests} です。` +
    `\`\`TEST_DATABASE_URL\`\` の無い環境では、\`\`npm test\`\` が ${unit.tests} 件を実行して ` +
    `${integration.tests} 件を skip します。`;

  let text = replaceBlock(source, "count", summary);
  text = replaceBlock(text, "breakdown", breakdown);

  const lines = text.split("\n");
  const stale = [];
  const missing = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s+\* - ``(tests\/[^`]+)``$/.exec(lines[index]);
    if (!match) continue;
    const file = match[1];
    seen.add(file);

    const countMatch = /^(\s+- )(\d+)$/.exec(lines[index + 1] ?? "");
    if (!countMatch) continue;

    const actual = counts.get(file);
    if (actual === undefined) {
      missing.push(file);
      continue;
    }
    if (Number(countMatch[2]) !== actual) {
      stale.push(`${file}: ${countMatch[2]} → ${actual}`);
      lines[index + 1] = `${countMatch[1]}${actual}`;
    }
  }

  const unlisted = [...counts.keys()].filter((file) => file.startsWith("tests/") && !seen.has(file));
  return { text: lines.join("\n"), summary, breakdown, stale, missing, unlisted, totals: { unit, integration, all } };
}

/** 原稿と実際の件数のずれを調べる。書かれた段落の数字も見る。 */
export function inspect(source, counts) {
  const applied = applyCounts(source, counts);
  const paragraphs =
    extractBlock(source, "count") !== applied.summary || extractBlock(source, "breakdown") !== applied.breakdown;
  return { ...applied, paragraphs };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const from = args.find((arg) => arg.startsWith("--from="))?.slice("--from=".length);

  let report;
  let failed = false;
  if (from) {
    report = readReport(path.resolve(from));
    if (!report) {
      console.error(`Vitest の結果を読めません: ${from}`);
      process.exit(1);
    }
  } else {
    ({ report, failed } = await runVitest());
  }
  if (!report) process.exit(1);

  const counts = byFile(report);
  const source = fs.readFileSync(scopePath, "utf8");
  const inspected = inspect(source, counts);
  const { all, unit, integration } = inspected.totals;

  console.log(
    `テスト: ${all.files} ファイル ${all.tests} 件（unit ${unit.files}/${unit.tests}、結合 ${integration.files}/${integration.tests}）`,
  );

  const drift = inspected.paragraphs || inspected.stale.length > 0;
  for (const file of inspected.missing) console.log(`  警告: 表にあるがテストが無い: ${file}`);
  for (const file of inspected.unlisted) console.log(`  警告: 表に無いテスト: ${file}`);

  if (check) {
    if (drift) {
      console.log(`  ずれています。npm run docs:counts で docs/testing/scope.rst を更新してください。`);
      for (const line of inspected.stale) console.log(`    ${line}`);
      process.exit(1);
    }
    console.log("  docs/testing/scope.rst と一致しています");
  } else {
    fs.writeFileSync(scopePath, inspected.text, "utf8");
    console.log("  -> docs/testing/scope.rst");
    if (inspected.stale.length > 0) {
      console.log(`  表の件数を直しました ${inspected.stale.length} 件:`);
      for (const line of inspected.stale) console.log(`    ${line}`);
    }
  }

  if (failed) {
    console.log("  警告: テストが失敗しています。");
    if (check) process.exit(1);
  }
}
