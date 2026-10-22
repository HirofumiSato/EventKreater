// docs 配下の走査と、原稿に書かれたリポジトリ内パスの解決をまとめる。
// check-doc-links.mjs と docs:gen の各スクリプトが同じ規則を使うための共有部品。
// ここを変えると索引・トレーサビリティ・リンク検査の結果が同時に変わる。

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DOCS_ROOT = path.join(ROOT, "docs");

// 実装前の設計文書は現在の構成と一致しないため、索引と検査の対象外にする。
export const PRE_IMPLEMENTATION_MARK = "実装前の設計文書です";

// docs:gen が作る索引。原稿ではないので doc-index の走査対象から外す。
export const GENERATED_DOCS = new Set([
  "docs/doc-index.json",
  "docs/api-routes.md",
  "docs/traceability.md",
]);

// 原稿の外にある索引・規約。ここもリポジトリ内パスを書くので同じ規則で扱う。
export const OUTSIDE_DOCS = [
  "AGENTS.md",
  "README.md",
  "llms.txt",
  path.join("services", "flyer", "AGENTS.md"),
  path.join("services", "flyer", "README.md"),
];

// 原稿中のパスは、リポジトリ直下と services/flyer の 2 つを起点に書かれる。
const BASES = [ROOT, path.join(ROOT, "services", "flyer")];

// 拡張子か末尾のスラッシュが無いものは、パスではなく見出しの引用とみなす。
// README などは ../ 始まりの相対リンクで書くため、その形も拾う。
const PATH_SOURCE =
  /(?<![\w/.@-])((?:\.\.\/)*(?:docs|src|tests|prisma|scripts|services|public)\/[\w\-./\[\]]*(?:\.[a-z]+|\/))(?![\w/])/g;

// 例示・省略・テンプレート・生成物は検査しない。
const SKIP_FRAGMENTS = ["*", "...", "{", "}", "<", ">", "$", ":", "#", "_build"];
const TRAILING = /[.,、。;:)\]"'`」』]+$/;

// これから書くテスト。docs/testing/scope.rst の「これから書くテスト」に列挙されている。
export const PLANNED = new Set([
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
export const KNOWN_MISSING = new Set([
  "src/lib/guards.ts", // 認可ガードは各ルートと src/lib/http.ts にある
  "src/lib/response.ts", // 応答生成は src/lib/serializers.ts と src/lib/problem.ts
  "src/lib/quota.ts", // 利用枠は src/modules/billing/lib/quota.ts
  "src/lib/db.ts", // prisma クライアントは src/lib/prisma.ts
  "src/types/event.ts", // 型は src/modules/<機能>/types.ts
]);

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function fromRoot(fullPath) {
  return toPosix(path.relative(ROOT, fullPath));
}

/** `_build` と `node_modules` を除いた docs 配下の .md / .rst。 */
export function collectDocFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === "_build" || entry === "node_modules" || entry === ".venv-docs") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".md") || entry.endsWith(".rst")) found.push(full);
    }
  };
  walk(DOCS_ROOT);
  return found;
}

export function readDoc(file) {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

export function isPreImplementation(body) {
  return body.includes(PRE_IMPLEMENTATION_MARK);
}

/**
 * 原稿 1 ファイル分のパス参照を取り出す。
 * `resolved` は実在した場合のリポジトリ相対パス（posix）、無ければ null。
 */
export function extractPathRefs(file, body) {
  const localDir = path.dirname(file);
  const refs = [];
  body.split("\n").forEach((line, index) => {
    const pattern = new RegExp(PATH_SOURCE.source, "g");
    for (const match of line.matchAll(pattern)) {
      const target = match[1].replace(TRAILING, "");
      const after = line.slice(match.index + match[0].length);
      // ``../../src/lib/...`` のような省略表記は検査しない。
      if (after.startsWith(".")) continue;
      if (!target || SKIP_FRAGMENTS.some((fragment) => target.includes(fragment))) continue;
      if (PLANNED.has(target)) continue;
      refs.push({
        target,
        line: index + 1,
        resolved: resolveRepoPath(target, localDir),
      });
    }
  });
  return refs;
}

/** 原稿からの相対リンク、リポジトリ直下、services/flyer の順に実在を確かめる。 */
export function resolveRepoPath(target, localDir) {
  if (target.startsWith(".")) {
    return existingRelative(path.resolve(localDir, target));
  }
  for (const base of BASES) {
    const resolved = existingRelative(path.join(base, target));
    if (resolved) return resolved;
  }
  // docs の中からリポジトリ直下の名前で書いた場合（docs/src/... のような誤記も拾う）。
  return existingRelative(path.join(localDir, target));
}

function existingRelative(fullPath) {
  if (!existsSync(fullPath)) return null;
  return fromRoot(fullPath);
}

/** 拡張子を除いた Sphinx の docname。docs の外なら null。 */
export function sphinxDocName(file) {
  const relative = path.relative(DOCS_ROOT, file);
  if (relative.startsWith("..")) return null;
  return toPosix(relative).replace(/\.(md|rst)$/, "");
}

export function walkFiles(dir, predicate) {
  const found = [];
  if (!existsSync(dir)) return found;
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      if (entry === "node_modules" || entry === "__pycache__" || entry === ".venv") continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (predicate(full)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** 見出しを除いた最初の段落を 1 行にし、指定文字数で切る。 */
export function firstParagraph(lines, startIndex) {
  const picked = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (picked.length === 0) {
      if (line === "" || line.startsWith("..") || line.startsWith("|") || line.startsWith("#")) continue;
      // RST の見出し下線だけの行は読み飛ばす。
      if (/^[=\-~^"']{3,}$/.test(line)) continue;
      // 見出し本体と次の下線行は、段落ではないのでまとめて飛ばす。
      if (/^[=\-~^"']{3,}$/.test(lines[index + 1]?.trim() ?? "")) {
        index += 1;
        continue;
      }
    }
    if (line === "") break;
    if (line.startsWith("..") || line.startsWith("|") || line.startsWith("#")) break;
    picked.push(line);
  }
  return cleanInline(picked.join(" "));
}

export function cleanInline(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/:(?:doc|ref|class|func|mod|term|meth|attr):`([^`]+)`/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}
