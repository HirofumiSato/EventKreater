// 画面のクラス名と CSS の突き合わせ。
//
//   src/**/*.tsx              … 製品が使うクラス（className の値だけを厳しく読む）
//   style-guide/**/*.html     … モックが使うクラス（class 属性と、その画面が読む CSS）
//   style-guide/**/*.js       … モックが JS で付けるクラス（"is-member" など）
//   src/styles/**, src/app/*.css … 製品とモックが共有する CSS
//   style-guide/*.css         … モック専用の CSS
//
// 見るのは 3 つ。どれも「モックを直したのに本体へ写していない」で起きる。
//
//   1. 製品が使うのに共有 CSS に無いクラス（missing）
//   2. 製品が使うのにモック専用 CSS にしか無いクラス（mock-only）
//   3. ある CSS にあるのに、それを読む画面が使っていないクラス（unused）
//
// 「使っている」かどうかは語で見る。`badgeTone()` のように関数の中でクラス名を
// 組み立てている画面を取りこぼすと、使っているものを未使用と誤って報告するため。
// 一方「定義が無い」の判定は className の値だけを見る。日本語の文言を拾わないため。

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 製品とモックが共有する CSS。分割前は src/app/attendance.css と deco.css がここに入る。 */
export const SHARED_CSS_DIRS = ["src/styles", "src/app"];
/** モック専用の CSS。製品はこれを読んではいけない。 */
export const MOCK_CSS_DIRS = ["style-guide"];
/** 製品のマークアップ。 */
export const TSX_DIR = "src";
/** モックのマークアップと、状態を付ける JS。 */
export const MOCK_DIR = "style-guide";

/** 例外の台帳。空を保つのが目標で、増やすときは理由を書く。 */
export const BASELINE_PATH = path.join("docs", "ui-review", "css-baseline.json");

const CLASS_NAME = /\.(-?[_a-zA-Z][\w-]*)/g;
const WORD = /[A-Za-z_][\w-]*/g;

/** BOM を落として改行を揃える。BOM が残ると先頭のセレクタが捨てられる。 */
export function readText(file) {
  return readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function walkFiles(dir, accept) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === "node_modules" || entry === ".next" || entry === "_build") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walkFiles(full, accept));
      continue;
    }
    if (accept(full)) found.push(full);
  }
  return found;
}

/** 指定ディレクトリ配下の CSS。 */
export function cssFiles(dirs) {
  return dirs
    .flatMap((dir) => walkFiles(path.join(ROOT, dir), (file) => file.endsWith(".css")))
    .filter((file) => !DOC_ONLY.has(relative(file)));
}

/** 製品の TSX。クラス名の厳密な判定に使う。 */
export function tsxFiles() {
  return walkFiles(path.join(ROOT, TSX_DIR), (file) => file.endsWith(".tsx"));
}

/** 製品の TS / TSX。語の収集に使う（`design-scope.ts` がクラス名を組み立てている）。 */
export function sourceFiles() {
  return walkFiles(path.join(ROOT, TSX_DIR), (file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

/**
 * スタイルガイド（`index.html` と `style-guide.css`）は画面のモックではなく仕様書なので、
 * 対応表の 29 画面から外す。ここでは読み込まない。
 */
export const DOC_ONLY = new Set(["style-guide/index.html", "style-guide/style-guide.css"]);

/** モックの HTML。スタイルガイド本体は除く。 */
export function mockHtmlFiles() {
  return walkFiles(path.join(ROOT, MOCK_DIR), (file) => file.endsWith(".html")).filter(
    (file) => !DOC_ONLY.has(relative(file)),
  );
}

/** モックの JS。 */
export function mockJsFiles() {
  return walkFiles(path.join(ROOT, MOCK_DIR), (file) => file.endsWith(".js"));
}

export function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** CSS のコメントを落とす。コメント中の `.example` を定義と数えないため。 */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * CSS が定義しているクラス名。
 *
 * `[^{}]*` で `{` の手前をセレクタとみなす。`@media` の中も同じ形で拾える。
 * `@media` / `@supports` / `@keyframes` の条件そのものは飛ばす。
 */
export function collectCssClasses(css) {
  const classes = new Set();
  const text = stripCssComments(css);
  for (const match of text.matchAll(/([^{}]*)\{/g)) {
    const selector = match[1];
    if (!selector.trim() || selector.trim().startsWith("@")) continue;
    for (const found of selector.matchAll(CLASS_NAME)) classes.add(found[1]);
  }
  return classes;
}

/** `${...}` を落としてから語に割る。`badge--${tone}` は接頭辞 `badge--` になる。 */
export function splitClassTokens(value) {
  const tokens = [];
  const prefixes = [];
  const withoutInterpolation = value.replace(/\$\{[^}]*\}/g, " ");
  for (const piece of withoutInterpolation.split(/\s+/)) {
    if (!piece) continue;
    const cleaned = piece.replace(/[^\w-]/g, "");
    if (!cleaned) continue;
    // 末尾が `-` の語は、動的に続きが付く接頭辞（`badge--`、`is-`）とみなす。
    if (cleaned.endsWith("-")) prefixes.push(cleaned);
    else tokens.push(cleaned);
  }
  return { tokens, prefixes };
}

/** 文字列リテラル（`"`、`'`、`` ` ``）の中身。テンプレートは `${...}` を残したまま返す。 */
export function stringLiterals(source) {
  const values = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== '"' && char !== "'" && char !== "`") continue;
    let cursor = index + 1;
    let value = "";
    while (cursor < source.length) {
      const current = source[cursor];
      if (current === "\\") {
        value += source.slice(cursor, cursor + 2);
        cursor += 2;
        continue;
      }
      if (current === char) break;
      value += current;
      cursor += 1;
    }
    if (cursor < source.length) {
      values.push(value);
      index = cursor;
    }
  }
  return values;
}

/** `className=` の値。引用符・テンプレート・`{...}` の 3 通りを読む。 */
export function classNameValues(source) {
  const values = [];
  const marker = "className=";
  let index = source.indexOf(marker);
  while (index !== -1) {
    let cursor = index + marker.length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    const first = source[cursor];
    if (first === '"' || first === "'") {
      const end = source.indexOf(first, cursor + 1);
      if (end === -1) break;
      values.push(source.slice(cursor + 1, end));
      index = source.indexOf(marker, end + 1);
      continue;
    }
    if (first === "`") {
      let depth = 0;
      let end = cursor + 1;
      for (; end < source.length; end += 1) {
        if (source[end] === "\\") {
          end += 1;
          continue;
        }
        if (source[end] === "`" && depth === 0) break;
        if (source[end] === "{" && source[end - 1] === "$") depth += 1;
        else if (source[end] === "}" && depth > 0) depth -= 1;
      }
      values.push(source.slice(cursor + 1, end));
      index = source.indexOf(marker, end + 1);
      continue;
    }
    if (first === "{") {
      let depth = 0;
      let end = cursor;
      for (; end < source.length; end += 1) {
        const current = source[end];
        if (current === '"' || current === "'" || current === "`") {
          let inner = end + 1;
          while (inner < source.length && source[inner] !== current) {
            inner += source[inner] === "\\" ? 2 : 1;
          }
          end = inner;
          continue;
        }
        if (current === "{") depth += 1;
        else if (current === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      // `{...}` の中の文字列リテラルだけを集める。三項や `cond && "x"` をそのまま扱える。
      const inner = source.slice(cursor + 1, end);
      for (const value of stringLiterals(inner)) values.push(value);
      index = source.indexOf(marker, end + 1);
      continue;
    }
    index = source.indexOf(marker, cursor + 1);
  }
  return values;
}

/** ソース中の語。未使用の判定にだけ使う（緩く見て、誤検出を出さない）。 */
export function collectWordTokens(text) {
  const tokens = new Set();
  for (const found of text.matchAll(WORD)) tokens.add(found[0]);
  return tokens;
}

function mergeInto(target, source) {
  for (const value of source) target.add(value);
}

/** 1 ファイル分の製品側の使用量。`className` の値だけをクラス名として厳しく読む。 */
export function collectTsxUsage(source) {
  const classNames = new Set();
  const prefixes = new Set();
  for (const value of classNameValues(source)) {
    const parsed = splitClassTokens(value);
    mergeInto(classNames, parsed.tokens);
    mergeInto(prefixes, parsed.prefixes);
  }
  return { classNames, prefixes, words: collectWordTokens(source) };
}

/** 1 枚のモックが読む CSS の実パス。`@import` は呼び出し側で辿る。 */
export function stylesheetLinks(htmlFile, source) {
  const links = [];
  for (const match of source.matchAll(/<link\b[^>]*>/g)) {
    const tag = match[0];
    if (!/rel="stylesheet"/.test(tag)) continue;
    const href = /href="([^"]+)"/.exec(tag);
    if (!href) continue;
    links.push(path.resolve(path.dirname(htmlFile), href[1]));
  }
  return links;
}

/** CSS が `@import` している実パス。入口のファイルから層を辿るために使う。 */
export function collectCssImports(file, source) {
  const imports = [];
  for (const match of source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
    const target = match[1];
    if (/^(https?:)?\/\//.test(target)) continue;
    imports.push(path.resolve(path.dirname(file), target));
  }
  return imports;
}

/** 入口から `@import` を辿った、実際に効く CSS の集合。 */
export function expandCssLinks(links, importsByPath) {
  const reachable = new Set();
  const queue = [...links];
  while (queue.length > 0) {
    const file = queue.shift();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const next of importsByPath.get(file) ?? []) queue.push(next);
  }
  return reachable;
}

/** モックの状態クラスは `mock-*.js` が付ける。全ページに効くとみなす。 */
export function mockScriptWords() {
  const words = new Set();
  for (const file of mockJsFiles()) mergeInto(words, collectWordTokens(readText(file)));
  return words;
}

/** 1 枚のモックの使用量と、その画面が読む CSS。 */
export function collectMockPage(file, scriptWords) {
  const source = readText(file);
  const classNames = new Set();
  const prefixes = new Set();
  for (const match of source.matchAll(/\bclass="([^"]*)"/g)) {
    const parsed = splitClassTokens(match[1]);
    mergeInto(classNames, parsed.tokens);
    mergeInto(prefixes, parsed.prefixes);
  }
  const words = collectWordTokens(source);
  mergeInto(words, scriptWords);
  return { file, classNames, prefixes, words, links: stylesheetLinks(file, source) };
}

export function loadBaseline() {
  const file = path.join(ROOT, BASELINE_PATH);
  if (!existsSync(file)) return { missing: {}, unused: {}, mockOnly: {} };
  const parsed = JSON.parse(readText(file));
  return {
    missing: parsed.missing ?? {},
    unused: parsed.unused ?? {},
    mockOnly: parsed.mockOnly ?? {},
  };
}

/** 接頭辞が語を覆うか。`badge--` は `badge--success` を覆う。 */
function coveredBy(name, prefixes) {
  for (const prefix of prefixes) {
    if (prefix.endsWith("-") && name.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * 突き合わせ。
 *
 * `sheets` は `{ file, kind, classes }`、`tsx` は製品の使用量、`pages` はモックの使用量。
 * 返すのは台帳（baseline）に載っていないものだけ。
 */
export function analyzeCssUsage({ sheets, tsx, pages, baseline }) {
  const shared = new Set();
  const all = new Set();
  for (const sheet of sheets) {
    mergeInto(all, sheet.classes);
    if (sheet.kind === "shared") mergeInto(shared, sheet.classes);
  }
  const byPath = new Map(sheets.map((sheet) => [sheet.file, sheet]));

  const missing = [];
  for (const name of tsx.classNames) {
    if (all.has(name) || name.endsWith("-") || baseline.missing[name]) continue;
    missing.push({ name, file: null });
  }
  for (const page of pages) {
    const defined = new Set();
    for (const link of page.reachable) {
      const sheet = byPath.get(link);
      if (sheet) mergeInto(defined, sheet.classes);
    }
    for (const name of page.classNames) {
      if (defined.has(name) || name.endsWith("-") || baseline.missing[name]) continue;
      if (missing.some((entry) => entry.name === name && entry.file === relative(page.file))) continue;
      missing.push({ name, file: relative(page.file) });
    }
  }

  const mockOnly = [];
  for (const name of tsx.classNames) {
    if (shared.has(name) || !all.has(name) || baseline.mockOnly[name]) continue;
    mockOnly.push({ name });
  }

  // CSS ごとに、それを読む画面の語を集める。製品の語はすべての共有 CSS に効く。
  const usedBySheet = new Map(sheets.map((sheet) => [sheet.file, new Set(sheet.kind === "shared" ? tsx.words : [])]));
  const prefixesBySheet = new Map(sheets.map((sheet) => [sheet.file, new Set(tsx.prefixes)]));
  for (const page of pages) {
    for (const link of page.reachable) {
      const used = usedBySheet.get(link);
      if (!used) continue;
      mergeInto(used, page.words);
      mergeInto(used, page.classNames);
      mergeInto(prefixesBySheet.get(link), page.prefixes);
    }
  }

  const unused = [];
  for (const sheet of sheets) {
    const used = usedBySheet.get(sheet.file);
    const prefixes = prefixesBySheet.get(sheet.file);
    for (const name of sheet.classes) {
      if (used.has(name) || coveredBy(name, prefixes) || baseline.unused[name]) continue;
      unused.push({ name, file: relative(sheet.file) });
    }
  }

  const sort = (entries) =>
    entries.sort((a, b) => a.name.localeCompare(b.name) || String(a.file).localeCompare(String(b.file)));
  return { missing: sort(missing), mockOnly: sort(mockOnly), unused: sort(unused) };
}

/** 台帳を書き戻す。理由は残っているものだけ引き継ぐ。 */
export function saveBaseline(report, previous) {
  const pick = (entries, reasons) =>
    Object.fromEntries(
      entries
        .map((entry) => [entry.name, reasons[entry.name] ?? ""])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const body = {
    $comment:
      "npm run ui:css の例外。空を保つのが目標。増やすときは、なぜクラスとして使っているのに CSS が無いのか（またはその逆か）を値に書く。",
    missing: pick(report.missing, previous.missing),
    mockOnly: pick(report.mockOnly, previous.mockOnly),
    unused: pick(report.unused, previous.unused),
  };
  const file = path.join(ROOT, BASELINE_PATH);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return file;
}
