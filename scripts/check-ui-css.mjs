// 製品とモックのクラス名が、CSS と食い違っていないかを見る。
//
//   npm run ui:css             # 検査（落ちたら差分を一覧で出す）
//   npm run ui:css -- --list   # 各 CSS の件数と、台帳に載っているものも全部出す
//   npm run ui:css -- --update # いまの状態を台帳へ書き戻す
//
// 検査は 3 つ。どれも「モックを直したのに本体へ写していない」で起きる。
//
//   1. 製品が使うのに共有 CSS に無いクラス
//   2. 製品が使うのにモック専用 CSS にしか無いクラス
//   3. ある CSS にあるのに、それを読む画面が使っていないクラス
//
// 3 は「モックの index.html だけが使っているクラス」も落とす。モックは画面ごとに
// 読む CSS が違うので、別の画面が使っているだけでは「使っている」ことにしない。
//
// 例外は docs/ui-review/css-baseline.json。空を保つのが目標。

import {
  analyzeCssUsage,
  collectCssClasses,
  collectCssImports,
  collectMockPage,
  collectTsxUsage,
  collectWordTokens,
  cssFiles,
  expandCssLinks,
  loadBaseline,
  mockHtmlFiles,
  mockJsFiles,
  mockScriptWords,
  readText,
  relative,
  saveBaseline,
  SHARED_CSS_DIRS,
  MOCK_CSS_DIRS,
  sourceFiles,
  tsxFiles,
} from "./lib/ui-css.mjs";

const args = new Set(process.argv.slice(2));
const listAll = args.has("--list");
const update = args.has("--update");

const sharedPaths = new Set(cssFiles(SHARED_CSS_DIRS).map((file) => file));
const mockPaths = new Set(cssFiles(MOCK_CSS_DIRS).map((file) => file));

const sheets = [...sharedPaths, ...mockPaths].map((file) => ({
  file,
  kind: sharedPaths.has(file) ? "shared" : "mock",
  classes: collectCssClasses(readText(file)),
}));

// `src/styles/index.css` は @import だけを持つ入口。実際に効く層まで辿る。
const importsByPath = new Map(sheets.map((sheet) => [sheet.file, collectCssImports(sheet.file, readText(sheet.file))]));

function mergeUsages(usages) {
  const merged = { classNames: new Set(), prefixes: new Set(), words: new Set() };
  for (const usage of usages) {
    for (const key of Object.keys(merged)) {
      for (const value of usage[key]) merged[key].add(value);
    }
  }
  return merged;
}

const tsx = mergeUsages(tsxFiles().map((file) => collectTsxUsage(readText(file))));
// `.ts` はクラス名を組み立てるだけなので、語の収集にだけ足す。
for (const file of sourceFiles()) {
  if (file.endsWith(".tsx")) continue;
  for (const word of collectWordTokens(readText(file))) tsx.words.add(word);
}
const scriptWords = mockScriptWords();
const pages = mockHtmlFiles().map((file) => {
  const page = collectMockPage(file, scriptWords);
  return { ...page, reachable: expandCssLinks(page.links, importsByPath) };
});

const baseline = loadBaseline();
const report = analyzeCssUsage({ sheets, tsx, pages, baseline });

if (update) {
  const file = saveBaseline(report, baseline);
  console.log(`台帳を書き戻しました: ${relative(file)}`);
  console.log(
    `  missing ${report.missing.length} / mock-only ${report.mockOnly.length} / unused ${report.unused.length}`,
  );
  process.exit(0);
}

const sharedCount = sheets.filter((sheet) => sheet.kind === "shared").reduce((sum, sheet) => sum + sheet.classes.size, 0);
const mockCount = sheets.filter((sheet) => sheet.kind === "mock").reduce((sum, sheet) => sum + sheet.classes.size, 0);

if (listAll) {
  console.log(`共有 CSS ${sheets.filter((sheet) => sheet.kind === "shared").length} ファイル ${sharedCount} クラス`);
  for (const sheet of sheets.filter((entry) => entry.kind === "shared")) {
    console.log(`  ${String(sheet.classes.size).padStart(4)}  ${relative(sheet.file)}`);
  }
  console.log(`モック CSS ${sheets.filter((sheet) => sheet.kind === "mock").length} ファイル ${mockCount} クラス`);
  for (const sheet of sheets.filter((entry) => entry.kind === "mock")) {
    console.log(`  ${String(sheet.classes.size).padStart(4)}  ${relative(sheet.file)}`);
  }
  console.log(`製品 TSX ${tsxFiles().length} ファイル / モック ${pages.length} 画面 + ${mockJsFiles().length} JS`);

  const missingAll = [...report.missing.map((entry) => entry.name), ...Object.keys(baseline.missing)].sort();
  console.log(`\n製品が使うのに未定義: ${missingAll.length} 件`);
  for (const name of missingAll) console.log(`  ${name}`);

  const unusedAll = [...report.unused.map((entry) => entry.name), ...Object.keys(baseline.unused)].sort();
  console.log(`\n未使用（CSS ごと）: ${unusedAll.length} 件`);
  for (const entry of report.unused) console.log(`  ${entry.name}  ${relative(entry.file)}`);
  process.exit(0);
}

function section(title, entries, withFile) {
  if (entries.length === 0) return false;
  console.log(`\n${title}（${entries.length} 件）`);
  for (const entry of entries) {
    console.log(`  ${entry.name}${withFile && entry.file ? `  ${relative(entry.file)}` : ""}`);
  }
  return true;
}

const failed = [];
if (section("製品が使うのに共有 CSS に無いクラス", report.missing, true)) failed.push("missing");
if (section("製品が使うのにモック専用 CSS にしか無いクラス", report.mockOnly, false)) failed.push("mock-only");
if (section("ある CSS にあるのに、それを読む画面が使っていないクラス", report.unused, true)) failed.push("unused");

// 直したのに台帳から消し忘れている項目。邪魔なので知らせる。
// 「台帳を無視した全件」と「台帳で抑制した結果」の差が、台帳に載っている項目。
const raw = analyzeCssUsage({
  sheets,
  tsx,
  pages,
  baseline: { missing: {}, mockOnly: {}, unused: {} },
});
const stale = (entries, reasons, kind) =>
  Object.keys(reasons)
    .filter((name) => !entries.some((entry) => entry.name === name))
    .sort()
    .map((name) => `${kind} ${name}`);
const staleLines = [
  ...stale(raw.missing, baseline.missing, "missing"),
  ...stale(raw.mockOnly, baseline.mockOnly, "mock-only"),
  ...stale(raw.unused, baseline.unused, "unused"),
];
if (staleLines.length > 0) {
  console.log(`\n台帳から消せる項目（${staleLines.length} 件）。--update で整理できます。`);
  for (const line of staleLines) console.log(`  ${line}`);
}

if (failed.length > 0) {
  console.error(`\nui:css NG（${failed.join(", ")}）`);
  console.error(
    "直すか、クラスとして持つ理由があるなら docs/ui-review/css-baseline.json に理由付きで載せてください。",
  );
  process.exit(1);
}

console.log(
  `ui:css OK（共有 ${sharedCount} クラス / モック ${mockCount} クラス、製品 ${tsxFiles().length} ファイル、モック ${pages.length} 画面 + ${mockJsFiles().length} JS）`,
);
