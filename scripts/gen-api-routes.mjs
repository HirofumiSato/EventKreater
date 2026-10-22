// src/app/api/**/route.ts を走査して docs/api-routes.md を作る。
//
//   npm run docs:gen
//
// ディレクトリ構造がそのまま URL になる Next.js App Router の規則を使い、
// 実装されたメソッドと、docs/backend_api_implementation_spec.md の表を突き合わせる。

import { writeFileSync } from "node:fs";
import path from "node:path";

import { DOCS_ROOT, fromRoot, readDoc, ROOT, walkFiles } from "./lib/docs-util.mjs";

const APP_ROOT = path.join(ROOT, "src", "app");
const API_ROOT = path.join(APP_ROOT, "api");
const SPEC = path.join(DOCS_ROOT, "backend_api_implementation_spec.md");
const OUTPUT = path.join(DOCS_ROOT, "api-routes.md");

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const METHOD_PATTERN = new RegExp(
  `^export\\s+(?:async\\s+)?(?:function|const)\\s+(${METHOD_ORDER.join("|")})\\b`,
  "gm",
);

function urlPathOf(file) {
  const dir = path.dirname(file);
  const segments = path.relative(APP_ROOT, dir).split(path.sep).filter(Boolean);
  // ルートグループ `(name)` は URL に含まれない。
  return `/${segments.filter((segment) => !/^\(.*\)$/.test(segment)).join("/")}`;
}

function normalizePath(value) {
  return value
    .replace(/[`*]/g, "")
    .replace(/\s+/g, "")
    .replace(/\[([^\]]+)\]/g, ":$1")
    .replace(/\{([^}]+)\}/g, ":$1")
    .replace(/[.,、。;:)\]]+$/, "");
}

function specTable(body) {
  const rows = new Map();
  for (const line of body.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const method = cells[2]?.replace(/[`*]/g, "").toUpperCase();
    const apiPath = cells[1] ?? "";
    if (!METHOD_ORDER.includes(method) || !apiPath.startsWith("/api/")) continue;
    const description = cells.slice(3).filter(Boolean).join(" ").replace(/\|/g, "/");
    rows.set(`${method} ${normalizePath(apiPath)}`, { path: apiPath.replace(/[`*]/g, ""), description });
  }
  return rows;
}

function proseLines(body) {
  return body
    .split("\n")
    .map((line) => normalizePath(line))
    .filter((line) => line.includes("/api/"));
}

function guardsUsed(body) {
  const imported = body.match(/import\s*\{([^}]+)\}\s*from\s*"@\/modules\/auth\/lib\/guards"/);
  if (!imported) return { level: "なし", names: [] };
  const names = imported[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const used = names.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(body));
  if (used.some((name) => name.startsWith("require"))) {
    return { level: "必須", names: used };
  }
  if (used.length > 0) return { level: "条件付き", names: used };
  return { level: "なし", names: [] };
}

const spec = readDoc(SPEC);
const documented = specTable(spec);
const prose = proseLines(spec);

const routes = [];
for (const file of walkFiles(API_ROOT, (candidate) => candidate.endsWith(`${path.sep}route.ts`))) {
  const body = readDoc(file);
  const methods = [...new Set([...body.matchAll(METHOD_PATTERN)].map((match) => match[1]))].sort(
    (left, right) => METHOD_ORDER.indexOf(left) - METHOD_ORDER.indexOf(right),
  );
  const guards = guardsUsed(body);
  for (const method of methods) {
    const apiPath = urlPathOf(file);
    const key = `${method} ${normalizePath(apiPath)}`;
    const tableRow = documented.get(key);
    const inProse =
      !tableRow &&
      prose.some((line) => line.includes(normalizePath(apiPath)) && new RegExp(`\\b${method}\\b`).test(line));
    routes.push({
      method,
      apiPath,
      key,
      file: fromRoot(file),
      guards,
      inSpec: Boolean(tableRow || inProse),
      specDescription: tableRow?.description ?? "",
    });
  }
}

routes.sort(
  (left, right) =>
    left.apiPath.localeCompare(right.apiPath, "en") ||
    METHOD_ORDER.indexOf(left.method) - METHOD_ORDER.indexOf(right.method),
);

const implementedKeys = new Set(routes.map((route) => route.key));
const specOnly = [...documented.entries()]
  .filter(([key]) => !implementedKeys.has(key))
  .sort(([left], [right]) => left.localeCompare(right, "en"));

const escapeCell = (value) => value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const truncate = (value, length) => (value.length > length ? `${value.slice(0, length)}…` : value);

const lines = [
  "# API ルート一覧",
  "",
  "*生成物: `npm run docs:gen`（scripts/gen-api-routes.mjs）。手で編集しないでください。*",
  "",
  "`src/app/api/**/route.ts` を走査した結果です。ディレクトリ構造がそのまま URL になり、ルートグループ `(...)` は URL に含めません。",
  "仕様の列は `docs/backend_api_implementation_spec.md` の表と本文に、同じメソッドとパスがあるかで判定しています。",
  "",
  `- ルートファイル: ${new Set(routes.map((route) => route.file)).size}`,
  `- エンドポイント（メソッド × パス）: ${routes.length}`,
  `- 仕様書に記載: ${routes.filter((route) => route.inSpec).length}`,
  `- 実装のみ（仕様書に記載なし）: ${routes.filter((route) => !route.inSpec).length}`,
  `- 仕様書のみ（実装なし）: ${specOnly.length}`,
  "",
  "## 一覧",
  "",
  "| メソッド | パス | 認可 | 仕様 | 実装ファイル |",
  "| --- | --- | --- | --- | --- |",
];

for (const route of routes) {
  const guardLabel =
    route.guards.names.length > 0
      ? `${route.guards.level}（${route.guards.names.join(", ")}）`
      : route.guards.level;
  lines.push(
    `| ${route.method} | \`${route.apiPath}\` | ${escapeCell(guardLabel)} | ${route.inSpec ? "あり" : "なし"} | \`${route.file}\` |`,
  );
}

lines.push("", "## 実装にあって仕様書に無いもの", "");
if (routes.every((route) => route.inSpec)) {
  lines.push("なし。");
} else {
  for (const route of routes.filter((candidate) => !candidate.inSpec)) {
    lines.push(`- \`${route.method} ${route.apiPath}\` — \`${route.file}\``);
  }
  lines.push(
    "",
    "仕様書側に追記するか、実装が不要なら削除します。`docs/README.md` の既知の乖離にも同じ内容を書きます。",
  );
}

lines.push("", "## 仕様書にあって実装が無いもの", "");
if (specOnly.length === 0) {
  lines.push("なし。");
} else {
  for (const [, row] of specOnly) {
    lines.push(`- \`${row.path}\`${row.description ? ` — ${truncate(row.description, 100)}` : ""}`);
  }
}

writeFileSync(OUTPUT, `${lines.join("\n")}\n`, "utf8");
console.log(
  `api-routes: ${routes.length} エンドポイント（仕様書 ${routes.filter((route) => route.inSpec).length} / 実装のみ ${routes.filter((route) => !route.inSpec).length} / 仕様書のみ ${specOnly.length}）`,
);
console.log(`  -> ${path.relative(process.cwd(), OUTPUT)}`);
