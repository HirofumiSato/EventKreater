// docs に書かれたリポジトリ内パスの実在を確認する。
// ルートと services/flyer の AGENTS.md / README.md も対象にする。
// Sphinx の linkcheck は外部 URL しか見ないので、ここで原稿中のパスを検査する。
//
//   npm run docs:links
//
// 失敗が 1 件でもあれば exit 1。CI には入れず、docs を触ったときに実行する。

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(root, "docs");

// 原稿の外にある索引類。ここもパスを書くので同じ規則で検査する。
const OUTSIDE_DOCS = [
  "AGENTS.md",
  "README.md",
  path.join("services", "flyer", "AGENTS.md"),
  path.join("services", "flyer", "README.md"),
];

// 原稿中のパスは、リポジトリ直下と services/flyer の 2 つを起点に書かれる。
const BASES = [root, path.join(root, "services", "flyer")];

// 拡張子か末尾のスラッシュが無いものは、パスではなく見出しの引用とみなす。
// README などは ../ 始まりの相対リンクで書くため、その形も拾う。
const PATH_PATTERN =
  /(?<![\w/.@-])((?:\.\.\/)*(?:docs|src|tests|prisma|scripts|services|public)\/[\w\-./\[\]]*(?:\.[a-z]+|\/))(?![\w/])/g;

// 例示・省略・テンプレート・生成物は検査しない。
const SKIP_FRAGMENTS = ["*", "...", "{", "}", "<", ">", "$", ":", "#", "_build"];
const TRAILING = /[.,、。;:)\]"'`」』]+$/;

// 実装前の設計文書は現在の構成と一致しないため対象外。冒頭の注意書きで判定する。
const PRE_IMPLEMENTATION_MARK = "実装前の設計文書です";

// これから書くテスト。docs/testing/scope.rst の「これから書くテスト」に列挙されている。
const PLANNED = new Set([
  "tests/routes/",
  "tests/routes/health.test.ts",
  "tests/routes/public-events.test.ts",
  "tests/routes/public-event-viewer.test.ts",
  "tests/routes/organizer-event.test.ts",
  "tests/integration/referrer.test.ts",
  "tests/components/",
  "tests/components/invite-card.test.tsx",
  "tests/components/register-required.test.tsx",
  "tests/e2e/",
]);

// 仕様書が指すが、その名前では実装されなかったもの。docs/README.md の既知の乖離に載せている。
// 直したらここからも消す。
const KNOWN_MISSING = new Set([
  "src/lib/guards.ts", // 認可ガードは各ルートと src/lib/http.ts にある
  "src/lib/response.ts", // 応答生成は src/lib/serializers.ts と src/lib/problem.ts
  "src/lib/quota.ts", // 利用枠は src/modules/billing/lib/quota.ts
  "src/lib/db.ts", // prisma クライアントは src/lib/prisma.ts
  "src/types/event.ts", // 型は src/modules/<機能>/types.ts
]);

function collectDocs(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "_build" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectDocs(full));
      continue;
    }
    if (entry.endsWith(".md") || entry.endsWith(".rst")) found.push(full);
  }
  return found;
}

function resolves(relative) {
  return BASES.some((base) => existsSync(path.join(base, relative)));
}

const failures = [];
let checked = 0;
let skippedFiles = 0;

for (const file of [
  ...collectDocs(docsRoot),
  ...OUTSIDE_DOCS.map((file) => path.join(root, file)).filter((file) => existsSync(file)),
]) {
  const body = readFileSync(file, "utf8");
  if (body.includes(PRE_IMPLEMENTATION_MARK)) {
    skippedFiles += 1;
    continue;
  }

  const localDir = path.dirname(file);
  body.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(PATH_PATTERN)) {
      const target = match[1].replace(TRAILING, "");
      const after = line.slice(match.index + match[0].length);
      // ``../../src/lib/...`` のような省略表記は検査しない。
      if (after.startsWith(".")) continue;
      if (!target || SKIP_FRAGMENTS.some((fragment) => target.includes(fragment))) continue;
      if (PLANNED.has(target) || KNOWN_MISSING.has(target)) continue;
      checked += 1;

      // ../ 始まりは原稿からの相対パス。それ以外はリポジトリ直下か services/flyer を起点にする。
      if (target.startsWith(".")) {
        if (existsSync(path.join(localDir, target))) continue;
      } else {
        const fromDocDir = path.relative(root, path.join(localDir, target));
        if (resolves(target) || resolves(fromDocDir)) continue;
      }
      failures.push({ file: path.relative(root, file), line: index + 1, target });
    }
  });
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
