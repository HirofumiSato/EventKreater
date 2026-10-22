// 原稿が指すコードと、コードを説明する原稿の対応を docs/traceability.md にまとめる。
//
//   npm run docs:gen
//
// パス基準の逆引き。仕様が指すファイルが実在するか、そのファイルを説明する文書はどれかを
// 1 ページで確認できるようにする。URL 基準の API 被覆もここで見る。

import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  collectDocFiles,
  DOCS_ROOT,
  extractPathRefs,
  fromRoot,
  GENERATED_DOCS,
  isPreImplementation,
  KNOWN_MISSING,
  OUTSIDE_DOCS,
  readDoc,
  ROOT,
  toPosix,
  walkFiles,
} from "./lib/docs-util.mjs";

const OUTPUT = path.join(DOCS_ROOT, "traceability.md");
const APP_ROOT = path.join(ROOT, "src", "app");
const API_ROOT = path.join(APP_ROOT, "api");

const CODE_PREFIXES = ["src/", "prisma/", "services/", "tests/", "scripts/", "public/"];
const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const API_URL = /(?<![\w/])\/api\/v[\w\-./\[\]]+/g;

const isCodePath = (value) => CODE_PREFIXES.some((prefix) => value.startsWith(prefix));

function normalizePath(value) {
  return value
    .replace(/[`*]/g, "")
    .replace(/\s+/g, "")
    .replace(/\[([^\]]+)\]/g, ":$1")
    .replace(/\{([^}]+)\}/g, ":$1")
    .replace(/[.,、。;:)\]]+$/, "");
}

function docLink(docPath) {
  // docs の外にある AGENTS.md などは Sphinx の文書ではない。
  // .md への相対リンクは MyST が文書参照として解決しようとするため、コード表記にする。
  if (!docPath.startsWith("docs/")) return `\`${docPath}\``;
  const relative = toPosix(path.relative(DOCS_ROOT, path.join(ROOT, docPath)));
  return `[${docPath}](${relative})`;
}

function urlPathOf(file) {
  const segments = path.relative(APP_ROOT, path.dirname(file)).split(path.sep).filter(Boolean);
  return `/${segments.filter((segment) => !/^\(.*\)$/.test(segment)).join("/")}`;
}

const sources = collectDocFiles()
  .map((file) => fromRoot(file))
  .filter((docPath) => !GENERATED_DOCS.has(docPath));
for (const outside of OUTSIDE_DOCS) {
  if (existsSync(path.join(ROOT, outside))) sources.push(toPosix(outside));
}

const codeToDocs = new Map();
const apiToDocs = new Map();
const missing = [];
let skippedPreImplementation = 0;

for (const docPath of sources) {
  const body = readDoc(path.join(ROOT, docPath));
  if (isPreImplementation(body)) {
    skippedPreImplementation += 1;
    continue;
  }

  const seen = new Set();
  for (const ref of extractPathRefs(path.join(ROOT, docPath), body)) {
    if (ref.resolved) {
      if (isCodePath(ref.resolved)) {
        if (!codeToDocs.has(ref.resolved)) codeToDocs.set(ref.resolved, new Set());
        codeToDocs.get(ref.resolved).add(docPath);
      }
      continue;
    }
    if (!isCodePath(ref.target) || seen.has(ref.target)) continue;
    seen.add(ref.target);
    missing.push({ target: ref.target, docPath, line: ref.line, known: KNOWN_MISSING.has(ref.target) });
  }

  for (const match of body.matchAll(new RegExp(API_URL.source, "g"))) {
    const url = normalizePath(match[0]);
    if (!apiToDocs.has(url)) apiToDocs.set(url, new Set());
    apiToDocs.get(url).add(docPath);
  }
}

// 同じパスの重複報告をまとめる。
const missingByPath = new Map();
for (const item of missing) {
  if (!missingByPath.has(item.target)) {
    missingByPath.set(item.target, { target: item.target, known: item.known, docs: new Set() });
  }
  missingByPath.get(item.target).docs.add(item.docPath);
}

const routes = [];
for (const file of walkFiles(API_ROOT, (candidate) => candidate.endsWith(`${path.sep}route.ts`))) {
  const body = readDoc(file);
  const methods = new Set(
    [...body.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm)].map(
      (match) => match[1],
    ),
  );
  const url = urlPathOf(file);
  const docs = apiToDocs.get(normalizePath(url)) ?? new Set();
  routes.push({ url, file: fromRoot(file), docs, methods: [...methods] });
}
routes.sort((left, right) => left.url.localeCompare(right.url, "en"));

const undocumentedRoutes = routes.filter((route) => route.docs.size === 0);
const knownMissing = [...missingByPath.values()].filter((item) => item.known);
const newMissing = [...missingByPath.values()].filter((item) => !item.known);

const lines = [
  "# トレーサビリティ（コード → 文書）",
  "",
  "*生成物: `npm run docs:gen`（scripts/gen-traceability.mjs）。手で編集しないでください。*",
  "",
  "原稿に書かれたリポジトリ内パスを逆引きし、どのコードをどの文書が説明しているかを並べます。",
  "冒頭で実装前の設計と断っている文書は、現在の構成と一致しないため対象外です。",
  "",
  `- 対象文書: ${sources.length - skippedPreImplementation}（実装前の設計 ${skippedPreImplementation} 件は除外）`,
  `- 文書から参照されているコードパス: ${codeToDocs.size}`,
  `- API ルート: ${routes.length}（どの文書にも URL が無いもの ${undocumentedRoutes.length}）`,
  `- 文書が指すが実在しないパス: ${missingByPath.size}（既知 ${knownMissing.length} / 新規 ${newMissing.length}）`,
  "",
  "## コード → 文書",
  "",
  "| コード | 参照する文書 |",
  "| --- | --- |",
];

for (const codePath of [...codeToDocs.keys()].sort((left, right) => left.localeCompare(right, "en"))) {
  const docs = [...codeToDocs.get(codePath)].sort().map(docLink).join(" / ");
  lines.push(`| \`${codePath}\` | ${docs} |`);
}

lines.push("", "## 文書が指すが実在しないパス", "");
if (missingByPath.size === 0) {
  lines.push("なし。");
} else {
  lines.push("| パス | 種別 | 参照する文書 |", "| --- | --- | --- |");
  for (const item of [...missingByPath.values()].sort((left, right) => left.target.localeCompare(right.target, "en"))) {
    const docs = [...item.docs].sort().map(docLink).join(" / ");
    lines.push(`| \`${item.target}\` | ${item.known ? "既知" : "新規"} | ${docs} |`);
  }
  lines.push(
    "",
    "既知のものは `scripts/lib/docs-util.mjs` の `KNOWN_MISSING` に登録されています。新規は仕様書か実装のどちらかを直します。",
  );
}

lines.push("", "## どの文書にも URL が出てこない API ルート", "");
if (undocumentedRoutes.length === 0) {
  lines.push("なし。");
} else {
  for (const route of undocumentedRoutes) {
    const methods = route.methods.sort(
      (left, right) => METHOD_ORDER.indexOf(left) - METHOD_ORDER.indexOf(right),
    );
    lines.push(`- \`${methods.join(", ")} ${route.url}\` — \`${route.file}\``);
  }
  lines.push(
    "",
    "`docs/backend_api_implementation_spec.md` に追記するか、不要なら実装を消します。",
  );
}

writeFileSync(OUTPUT, `${lines.join("\n")}\n`, "utf8");
console.log(
  `traceability: コード ${codeToDocs.size} パス、API ${routes.length} 本（未記載 ${undocumentedRoutes.length}）、実在しないパス ${missingByPath.size}（新規 ${newMissing.length}）`,
);
console.log(`  -> ${path.relative(process.cwd(), OUTPUT)}`);
