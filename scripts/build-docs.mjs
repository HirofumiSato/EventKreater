import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const win = process.platform === "win32";
const venvPython = path.join(
  root,
  ".venv-docs",
  win ? "Scripts" : "bin",
  win ? "python.exe" : "python",
);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const action = process.argv[2] ?? "html";

if (action === "install") {
  if (!existsSync(venvPython)) {
    run("python", ["-m", "venv", path.join(root, ".venv-docs")]);
  }
  run(venvPython, ["-m", "pip", "install", "-r", path.join(root, "docs", "requirements.txt")]);
  process.exit(0);
}

if (!existsSync(venvPython)) {
  console.error("ドキュメント用の Python 環境がありません。先に npm run docs:install を実行してください。");
  process.exit(1);
}

// `-j auto` は CPU 数に合わせてページの読み書きを並列にする。Windows の Sphinx 8 系でも動く。
// 落ちる環境では `-j 1` に落とす。`-q` は進捗の行だけを消し、WARNING は stderr に残る。
const startedAt = process.hrtime.bigint();
run(venvPython, [
  "-m",
  "sphinx",
  "-b",
  "html",
  "-j",
  "auto",
  "-q",
  path.join(root, "docs"),
  path.join(root, "docs", "_build", "html"),
]);
const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
console.log(`docs: ${seconds.toFixed(1)}s`);
