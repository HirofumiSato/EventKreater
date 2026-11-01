// 生成物を、中身が変わったときだけ書く。
//
//   scripts/gen-*.mjs        … docs の索引と件数
//   scripts/mock-sync.mjs    … モック（同じ実装をこのファイルの中にも持つ）
//
// 毎回書くと mtime が動く。Sphinx の増分ビルドは mtime で「変わった」と判断するので、
// 内容が同じでも 4 ページを作り直してしまう。git も差分として拾わない方が扱いやすい。
//
// 中身の比較は文字列で行う。生成物はいずれも決定的な文字列なので、これで足りる。

import { readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

/** 同期版。gen-*.mjs はもともと writeFileSync で書いているので、こちらを使う。 */
export function writeFileIfChangedSync(file, content) {
  try {
    if (readFileSync(file, "utf8") === content) return false;
  } catch {
    // 無ければ書く。
  }
  writeFileSync(file, content, "utf8");
  return true;
}

/** 非同期版。既存の `await writeFile` をそのまま置き換えられる形にする。 */
export async function writeFileIfChanged(file, content) {
  try {
    if ((await readFile(file, "utf8")) === content) return false;
  } catch {
    // 無ければ書く。
  }
  await writeFile(file, content, "utf8");
  return true;
}
