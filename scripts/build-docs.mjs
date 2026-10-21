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

run(venvPython, [
  "-m",
  "sphinx",
  "-b",
  "html",
  path.join(root, "docs"),
  path.join(root, "docs", "_build", "html"),
]);
