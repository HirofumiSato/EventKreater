// docs 配下の原稿を走査して docs/doc-index.json を作る。
//
//   npm run docs:gen
//
// AI と開発者が「どの文書があり、何を説明し、どのコードを指すか」を
// 1 ファイルで引けるようにする。Sphinx の toctree もここに写す。

import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  cleanInline,
  collectDocFiles,
  DOCS_ROOT,
  extractPathRefs,
  firstParagraph,
  fromRoot,
  GENERATED_DOCS,
  isPreImplementation,
  readDoc,
  sphinxDocName,
  toPosix,
} from "./lib/docs-util.mjs";

const OUTPUT = path.join(DOCS_ROOT, "doc-index.json");

const RST_UNDERLINE = /^([=\-~^"'])\1{2,}\s*$/;
const MD_HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const MD_TITLE = /^#\s+(.+?)\s*$/;

function mdHeadings(lines) {
  const headings = [];
  for (const line of lines) {
    const match = line.match(MD_HEADING);
    if (match) headings.push({ level: match[1].length, text: cleanInline(match[2]) });
  }
  return headings;
}

function rstHeadings(lines) {
  const levels = new Map();
  const headings = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const text = lines[index].trim();
    const underline = lines[index + 1].match(RST_UNDERLINE);
    if (!underline || text === "" || text.startsWith("..")) continue;
    const char = underline[1];
    if (!levels.has(char)) levels.set(char, levels.size + 1);
    headings.push({ level: Math.min(levels.get(char), 6), text: cleanInline(text) });
    index += 1;
  }
  return headings;
}

function titleOf(file, lines, headings) {
  if (file.endsWith(".md")) {
    for (const line of lines) {
      const match = line.match(MD_TITLE);
      if (match) return cleanInline(match[1]);
    }
  }
  if (headings.length > 0) return headings[0].text;
  return path.basename(file).replace(/\.(md|rst)$/, "");
}

/** 見出しの直後から本文が始まる位置。 */
function contentStart(file, lines, title) {
  if (file.endsWith(".md")) {
    const index = lines.findIndex((line) => line.match(MD_TITLE));
    return index >= 0 ? index + 2 : 0;
  }
  const index = lines.findIndex(
    (line, cursor) => line.trim() === title && RST_UNDERLINE.test(lines[cursor + 1] ?? ""),
  );
  return index >= 0 ? index + 3 : 0;
}

function resolveEntry(dir, entry) {
  const candidates = /\.(md|rst)$/.test(entry)
    ? [path.join(dir, entry)]
    : [path.join(dir, `${entry}.rst`), path.join(dir, `${entry}.md`)];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? fromRoot(found) : null;
}

function toctreeEntries(file, lines) {
  const entries = [];
  const dir = path.dirname(file);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*(?:```\{toctree\}|\.\. toctree::)\s*$/.test(lines[index])) continue;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (trimmed.startsWith("```")) break;
      if (!/^\s+/.test(line)) break;
      if (trimmed.startsWith(":")) continue;
      const named = trimmed.match(/^.*<([^>]+)>$/);
      const entry = (named ? named[1] : trimmed).trim();
      if (entry === "") continue;
      const resolved = resolveEntry(dir, entry);
      if (resolved) entries.push(resolved);
    }
  }
  return entries;
}

const files = collectDocFiles().filter((file) => !GENERATED_DOCS.has(fromRoot(file)));
const docs = [];
const includedBy = new Map();

for (const file of files) {
  const body = readDoc(file);
  const lines = body.split("\n");
  const headings = file.endsWith(".md") ? mdHeadings(lines) : rstHeadings(lines);
  const title = titleOf(file, lines, headings);
  const seen = new Map();
  for (const ref of extractPathRefs(file, body)) {
    if (!seen.has(ref.target)) seen.set(ref.target, ref.resolved);
  }
  const toctree = toctreeEntries(file, lines);
  for (const child of toctree) {
    if (!includedBy.has(child)) includedBy.set(child, new Set());
    includedBy.get(child).add(fromRoot(file));
  }
  docs.push({
    path: fromRoot(file),
    sphinxDoc: sphinxDocName(file),
    format: file.endsWith(".md") ? "markdown" : "rst",
    title,
    summary: firstParagraph(lines, contentStart(file, lines, title)),
    preImplementation: isPreImplementation(body),
    lineCount: lines.length,
    headings,
    toctree,
    codePaths: [...seen.entries()]
      .map(([target, resolved]) => ({ path: resolved ?? target, exists: resolved !== null }))
      .sort((left, right) => left.path.localeCompare(right.path, "en")),
  });
}

docs.sort((left, right) => left.path.localeCompare(right.path, "en"));
for (const doc of docs) {
  doc.includedBy = [...(includedBy.get(doc.path) ?? [])].sort();
}

const payload = {
  generatedBy: "scripts/gen-doc-index.mjs",
  note: "npm run docs:gen で再生成する。手で編集しない。",
  stats: {
    docs: docs.length,
    preImplementation: docs.filter((doc) => doc.preImplementation).length,
    markdown: docs.filter((doc) => doc.format === "markdown").length,
    rst: docs.filter((doc) => doc.format === "rst").length,
    orphan: docs.filter((doc) => doc.includedBy.length === 0).length,
  },
  docs,
};

writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(
  `doc-index: ${payload.stats.docs} 文書（Markdown ${payload.stats.markdown} / RST ${payload.stats.rst}、実装前 ${payload.stats.preImplementation}、toctree 未掲載 ${payload.stats.orphan}）`,
);
console.log(`  -> ${toPosix(path.relative(process.cwd(), OUTPUT))}`);
