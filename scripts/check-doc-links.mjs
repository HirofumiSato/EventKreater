// docs に書かれたリポジトリ内パスの実在を確認する。
// ルートと services/flyer の AGENTS.md / README.md、生成物の llms.txt も対象にする。
// Sphinx の linkcheck は外部 URL しか見ないので、ここで原稿中のパスを検査する。
//
//   npm run docs:links
//
// 失敗が 1 件でもあれば exit 1。CI の docs ジョブで実行する。
// パスの拾い方と免除リストは scripts/lib/docs-util.mjs に集約し、
// docs:gen のトレーサビリティと同じ規則を使う。

import { existsSync } from "node:fs";
import path from "node:path";

import {
  collectDocFiles,
  extractPathRefs,
  isPreImplementation,
  KNOWN_MISSING,
  OUTSIDE_DOCS,
  readDoc,
  ROOT,
} from "./lib/docs-util.mjs";

const failures = [];
let checked = 0;
let skippedFiles = 0;

const targets = [
  ...collectDocFiles(),
  ...OUTSIDE_DOCS.map((file) => path.join(ROOT, file)).filter((file) => existsSync(file)),
];

for (const file of targets) {
  const body = readDoc(file);
  if (isPreImplementation(body)) {
    skippedFiles += 1;
    continue;
  }

  for (const ref of extractPathRefs(file, body)) {
    if (KNOWN_MISSING.has(ref.target)) continue;
    checked += 1;
    if (!ref.resolved) {
      failures.push({
        file: path.relative(ROOT, file),
        line: ref.line,
        target: ref.target,
      });
    }
  }
}

if (failures.length === 0) {
  console.log(
    `docs:links OK (${checked} 件のパスを確認、実装前の設計 ${skippedFiles} ファイルは対象外)`,
  );
  process.exit(0);
}

console.error(`docs:links NG (${failures.length} 件 / 確認 ${checked} 件)`);
for (const failure of failures) {
  console.error(`  ${failure.file}:${failure.line}  ${failure.target}`);
}
process.exit(1);
