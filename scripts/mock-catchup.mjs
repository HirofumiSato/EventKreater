// モック（style-guide/mock-*.html）を、まとめて製品へ追いつかせる。
//
//   npm run mock:catchup                  # 全画面を本番ビルドで撮り、同期を確かめる
//   npm run mock:catchup -- --refresh     # 控えを使わずに取り直す
//   npm run mock:catchup -- --no-shots    # HTML だけ（PNG を撮らない）
//
// 実装 PR ではモックを追いつかせない。製品が正で、モックは遅れて届く生成物なので、
// `npm run check` や CI は同期漏れでは止めない。その代わり、任意のタイミングで
// この 1 コマンドを回せば、デモデータの確認から撮影・同期の検証まで終わる。
// 実装の PR にモックの差分を混ぜず、専用の PR にまとめられるようにするための wrapper。
//
// 手順は 3 段。
//
// 1. `storage/ui-demo.json` があるかを見る。無ければ `npm run db:seed:ui` を案内して終わる
//    （デモデータは勝手に作り直さない。DB の状態を変えるのは呼んだ人の判断にする）。
// 2. `scripts/mock-sync.mjs` で全画面を撮る。`--refresh` などの引数はそのまま渡す。
// 3. `scripts/check-mock-sync.mjs` で、書き出したモックがソースと合っているかを見る。
//
// `--only` は受けない。1 画面だけ直す反復は「一括」ではないので、`mock:sync` を
// 直接使ってもらう（dev で撮る・コミットしない、という既定もそちら側の話になる）。

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_FILE = path.join(root, "storage", "ui-demo.json");

const args = process.argv.slice(2);

// --only は一括同期の意味を無くす（部分同期は uiHash を進めないので、追いついたことに
// ならない）。DB もビルドもブラウザも使う前に、ここで止める。
const onlyArg = args.find((arg) => arg === "--only" || arg.startsWith("--only="));
if (onlyArg) {
  console.error("--only は一括同期では使えません。");
  console.error("1 画面だけ直すときは `npm run mock:sync -- --only=...` を使ってください。");
  process.exit(1);
}

if (!fs.existsSync(DEMO_FILE)) {
  console.error("storage/ui-demo.json がありません。先に `npm run db:seed:ui` を実行してください。");
  process.exit(1);
}

/**
 * リポジトリ内のスクリプトを順に走らせ、終了コードをそのまま返す。
 *
 * stdio は inherit にする。mock:sync は画面ごとの進み具合を出し、数分かかるので、
 * 出力を溜めて最後に見せると何が起きているか分からない。
 */
function run(script, scriptArgs = []) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [path.join(root, script), ...scriptArgs], {
        cwd: root,
        stdio: "inherit",
        env: process.env,
      });
    } catch (error) {
      console.error(`${script} を起動できません: ${error.message}`);
      resolve(1);
      return;
    }
    child.on("error", (error) => {
      console.error(`${script} を起動できません: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  console.log("モックをまとめて追いつかせます（全画面・本番ビルド）。");

  // 引数は mock:sync にだけ渡す。check-mock-sync は引数を取らない。
  const synced = await run("scripts/mock-sync.mjs", args);
  if (synced !== 0) {
    console.error("\nmock:sync が失敗しました。出力を確認してから、もう一度実行してください。");
    process.exit(synced);
  }

  const checked = await run("scripts/check-mock-sync.mjs");
  if (checked !== 0) {
    console.error("\n同期の確認に失敗しました。出力の指摘を直してから、もう一度実行してください。");
    process.exit(checked);
  }

  console.log(
    "\n追いつきました。style-guide/ 以下の差分をコミットしてください" +
      "（モックは専用の PR にまとめるとレビューしやすい）。",
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
