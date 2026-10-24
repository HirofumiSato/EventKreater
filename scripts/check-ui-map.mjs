// モック目録・対応表・実装ルートの食い違いを検査する。
//
//   npm run ui:map
//
// 1. style-guide/mock-screens-data.js の 29 画面を読む
// 2. docs/ui-review/mock-implementation-map.md の表を読む
// 3. 次を確かめる
//    - 29 画面が対応表に 1 回ずつ載っている
//    - 目録と表で No / 画面 / mock ファイル / 実装パス / スコープが一致する
//    - 実装パスが実在する page.tsx に解決する
//    - 状態が 未着手 / 移行中 / 検証済 / 保留 のいずれか
//
// 画面を足したのに表を直していないと落ちる。数十 ms で終わる。

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCREENS_FILE = path.join(ROOT, "style-guide", "mock-screens-data.js");
const MAP_FILE = path.join(ROOT, "docs", "ui-review", "mock-implementation-map.md");

const ALLOWED_STATUS = new Set(["未着手", "移行中", "検証済", "保留"]);
const ALLOWED_SCOPE = new Set(["pop", "quiet"]);
const EXPECTED_HEADER = [
  "No",
  "画面",
  "mockファイル",
  "実装パス",
  "page.tsx",
  "主な子コンポーネント",
  "スコープ",
  "必要な状態・データ",
  "移行単位",
  "状態",
];

const failures = [];

function fail(message) {
  failures.push(message);
}

/** `window.MOCK_SCREENS = [...]` を評価して配列を取り出す。ブラウザは要らない。 */
function loadMockScreens() {
  if (!existsSync(SCREENS_FILE)) {
    throw new Error(`目録が見つかりません: ${path.relative(ROOT, SCREENS_FILE)}`);
  }
  const source = readFileSync(SCREENS_FILE, "utf8");
  const sandbox = {};
  // 目録は `window.MOCK_GROUPS = [...]` と `window.MOCK_SCREENS = [...]` の代入だけを持つ。
  // eslint-disable-next-line no-new-func
  new Function("window", source)(sandbox);
  if (!Array.isArray(sandbox.MOCK_SCREENS)) {
    throw new Error("mock-screens-data.js から MOCK_SCREENS を読めませんでした");
  }
  return sandbox.MOCK_SCREENS;
}

/** Markdown の表のセルを分解する。`\|` のエスケープだけ考慮する。 */
function splitRow(line) {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(line) {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

/** 対応表の行を集める。見出し行が EXPECTED_HEADER と一致する表だけを対象にする。 */
function loadMapRows() {
  if (!existsSync(MAP_FILE)) {
    throw new Error(`対応表が見つかりません: ${path.relative(ROOT, MAP_FILE)}`);
  }
  const lines = readFileSync(MAP_FILE, "utf8").replace(/\r\n/g, "\n").split("\n");
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("|")) continue;
    const header = splitRow(line);
    if (header.length !== EXPECTED_HEADER.length) continue;
    if (header.some((cell, position) => cell !== EXPECTED_HEADER[position])) continue;
    if (!isSeparator(lines[index + 1] ?? "")) {
      fail(`対応表の見出しの次が区切り行ではありません（${index + 1} 行目）`);
      continue;
    }
    let cursor = index + 2;
    for (; cursor < lines.length; cursor += 1) {
      const rowLine = lines[cursor].trim();
      if (!rowLine.startsWith("|")) break;
      const cells = splitRow(rowLine);
      if (cells.length !== EXPECTED_HEADER.length) {
        fail(`列数が ${EXPECTED_HEADER.length} ではありません（${cursor + 1} 行目: ${rowLine}）`);
        continue;
      }
      rows.push({
        line: cursor + 1,
        no: cells[0],
        name: cells[1],
        file: cells[2].replace(/`/g, ""),
        route: cells[3].replace(/`/g, ""),
        pagePath: cells[4],
        scope: cells[6],
        status: cells[9],
      });
    }
    index = cursor - 1;
  }
  return rows;
}

/** `/` は src/app/page.tsx、`/a/b` は src/app/a/b/page.tsx。 */
function pageFileFor(route) {
  const normalized = route.replace(/`/g, "").trim();
  if (!normalized.startsWith("/")) return null;
  const suffix = normalized === "/" ? "" : normalized;
  return path.join("src", "app", `${suffix}/page.tsx`.replace(/\/+/g, "/"));
}

function main() {
  const screens = loadMockScreens();
  const rows = loadMapRows();

  if (rows.length === 0) {
    fail("対応表に行が 1 つもありません");
  }

  const seen = new Map();
  for (const row of rows) {
    if (!/^\d{2}$/.test(row.no)) {
      fail(`No が 2 桁の数字ではありません（${row.line} 行目: ${row.no}）`);
      continue;
    }
    if (seen.has(row.no)) {
      fail(`No ${row.no} が重複しています（${seen.get(row.no)} 行目と ${row.line} 行目）`);
      continue;
    }
    seen.set(row.no, row.line);

    if (!ALLOWED_STATUS.has(row.status)) {
      fail(`No ${row.no} の状態が規定外です: ${row.status}`);
    }

    const pagePath = pageFileFor(row.route);
    if (!pagePath) {
      fail(`No ${row.no} の実装パスが / で始まっていません: ${row.route}`);
      continue;
    }
    if (!existsSync(path.join(ROOT, pagePath))) {
      fail(`No ${row.no} の page.tsx がありません: ${pagePath}`);
    }
    const declared = row.pagePath.replace(/`/g, "").replace(/\\/g, "/");
    if (declared !== pagePath.split(path.sep).join("/")) {
      fail(`No ${row.no} の page.tsx 列が実装パスと一致しません: ${declared}（期待 ${pagePath}）`);
    }
  }

  for (const screen of screens) {
    const row = seen.has(screen.no) ? rows.find((item) => item.no === screen.no) : null;
    if (!row) {
      fail(`No ${screen.no}（${screen.name}）が対応表にありません`);
      continue;
    }
    if (row.name !== screen.name) {
      fail(`No ${screen.no} の画面名が目録と一致しません: ${row.name}（期待 ${screen.name}）`);
    }
    if (row.file !== screen.file) {
      fail(`No ${screen.no} の mock ファイルが目録と一致しません: ${row.file}（期待 ${screen.file}）`);
    }
    if (row.route !== screen.path) {
      fail(`No ${screen.no} の実装パスが目録と一致しません: ${row.route}（期待 ${screen.path}）`);
    }
    if (!ALLOWED_SCOPE.has(screen.scope)) {
      fail(`No ${screen.no} の目録のスコープが規定外です: ${screen.scope}`);
    }
    if (row.scope !== screen.scope) {
      fail(`No ${screen.no} のスコープが目録と一致しません: ${row.scope}（期待 ${screen.scope}）`);
    }
  }

  if (rows.length !== screens.length) {
    fail(`対応表 ${rows.length} 行 / 目録 ${screens.length} 画面。件数が一致しません`);
  }

  if (failures.length === 0) {
    const counts = rows.reduce((accumulator, row) => {
      accumulator[row.status] = (accumulator[row.status] ?? 0) + 1;
      return accumulator;
    }, {});
    const summary = Object.entries(counts)
      .map(([status, count]) => `${status} ${count}`)
      .join(" / ");
    console.log(`ui:map OK（${screens.length} 画面を確認: ${summary}）`);
    process.exit(0);
  }

  console.error(`ui:map NG（${failures.length} 件）`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

main();
