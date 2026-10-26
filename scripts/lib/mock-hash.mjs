// 「モックに写るソース」の指紋。`npm run check` をブラウザなしで止めるために使う。
//
//   scripts/mock-sync.mjs        … 書き出したときの指紋を manifest に残す
//   scripts/check-mock-sync.mjs  … いまの指紋と manifest を比べる
//   tests/unit/mock-sync.test.mjs
//
// 指紋の対象は、画面の見た目を決めるファイルだけ。API や DB を変えても、
// 画面の TSX が変わらなければモックは変わらない（データは撮るたびに DB から来る）。
// 逆に、ここに入れたファイルを 1 文字変えたら必ず指紋が変わる。
//
// 迷ったら足す。取りこぼすと「同期したつもりで古いモックがコミットされる」ほうが、
// 余計に同期が走るより高くつく。

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** ディレクトリと、そこから拾う拡張子。 */
const DIRECTORIES = [
  { dir: "src/app", extensions: [".tsx", ".css"] },
  { dir: "src/components", extensions: [".tsx", ".ts", ".css"] },
  { dir: "src/styles", extensions: [".css"] },
  // 画面専用の部品だけ。modules/<機能>/lib は DOM を作らないので含めない。
  { dir: "src/modules", extensions: [".tsx", ".ts", ".css"], componentsOnly: true },
];

/** 単体で見るファイル。 */
const FILES = [
  "src/lib/format.ts",
  "src/lib/site.ts",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
];

/** 指紋の対象になるファイル（リポジトリからの相対パス、`/` 区切り、辞書順）。 */export function uiSourceFiles(root) {
  const found = [];

  const walk = (dir, accept) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const full = path.join(dir, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(full, accept);
        continue;
      }
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (accept(relative)) found.push(relative);
    }
  };

  for (const entry of DIRECTORIES) {
    const base = path.join(root, ...entry.dir.split("/"));
    walk(base, (relative) => {
      if (!entry.extensions.includes(path.extname(relative))) return false;
      if (entry.componentsOnly && !/^src\/modules\/[^/]+\/components\//.test(relative)) return false;
      return true;
    });
  }

  for (const file of FILES) {
    try {
      if (statSync(path.join(root, ...file.split("/"))).isFile()) found.push(file);
    } catch {
      // 無い設定ファイルは対象外。
    }
  }

  return [...new Set(found)].sort();
}

/**
 * 改行を LF にそろえる。
 *
 * 指紋は OS をまたいで同じでなければならない。Windows の作業ツリーには
 * CRLF のファイルが混ざる（`.gitattributes` の `eol=lf` を経由せずに書かれた
 * ファイルなど）ので、中身を比べる前に改行だけを落とす。CI は LF で checkout
 * するため、ここをそろえないと「手元では通るのに CI だけ落ちる」になる。
 */
export function normalizeNewlines(buffer) {
  if (!buffer.includes(0x0d)) return buffer;
  const out = Buffer.allocUnsafe(buffer.length);
  let length = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === 0x0d && buffer[index + 1] === 0x0a) continue;
    out[length] = byte;
    length += 1;
  }
  return out.subarray(0, length);
}

/**
 * 指紋。パスと中身を並べて 1 つの sha256 にする。
 * ファイル名を変えただけでも変わる（リンクの対応表が変わるため）。
 */
export function computeUiHash(root) {
  const hash = createHash("sha256");
  for (const file of uiSourceFiles(root)) {
    hash.update(file);
    hash.update("\0");
    hash.update(normalizeNewlines(readFileSync(path.join(root, ...file.split("/")))));
    hash.update("\0");
  }
  return hash.digest("hex");
}
