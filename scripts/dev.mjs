import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isStuckBuildLine,
  shouldRestartNow,
  STUCK_RESTART_DELAY_MS,
  STUCK_RESTART_GRACE_MS,
  STUCK_RESTART_MIN_INTERVAL_MS,
} from "./lib/dev-stuck.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

let webChild = null;
let restartTimer = null;
let lastWebRestartAt = null;
/** 立て直せないときに、案内を最後に出した時刻。同じ文を連投しない。 */
let lastStuckNoticeAt = null;
/** 立て直した直後の、前のプロセスの失敗を読み飛ばす期限。 */
let restartQuietUntil = 0;
/** こちらから止めている最中か。止めた子の終了コードを「異常終了」と読み違えない。 */
let stoppingWeb = false;
let shuttingDown = false;

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/** 子プロセスを、その子ごと止める。 */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

/**
 * 子を 1 つ起こす。
 *
 * `watchOutput` を立てた子だけ、出力を受け取って画面へ流しながら行を読む
 * （見張るため。受け取ると色が消えるので `FORCE_COLOR` を渡す）。
 */
function launch(label, command, cwd, { watchOutput = false, onLine = () => {} } = {}) {
  const colored = watchOutput && process.stdout.isTTY;
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: watchOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    env: colored ? { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" } : process.env,
  });
  children.push(child);

  if (watchOutput) {
    forwardLines(child.stdout, process.stdout, onLine);
    forwardLines(child.stderr, process.stderr, onLine);
  }

  child.on("exit", (code, signal) => {
    if (stoppingWeb || shuttingDown) {
      stoppingWeb = false;
      return;
    }
    if (signal || code === 0 || code === null) return;
    console.error(`[${label}] exited with ${code}`);
  });
  return child;
}

/** 受け取った出力をそのまま画面へ流しつつ、行ごとに `onLine` へ渡す。 */
function forwardLines(stream, sink, onLine) {
  if (!stream) return;
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    sink.write(chunk);
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
}

/**
 * ビルドが「ファイルを掴まれて読めなかった」失敗で止まったとき、開発サーバーを立て直す。
 *
 * この失敗は Turbopack が覚えたままで、以後どの URL も 500 を返し続ける（再起動だけが効く）。
 * OneDrive の下の作業ツリーでは、保存の直後に一時的な掴みが起きうる。
 * 原因が手元のコードにある失敗（構文エラーなど）は、ここでは拾わない。
 */
function onStuckBuild() {
  if (shuttingDown || restartTimer) return;
  // 立て直した直後に流れてくる、前のプロセスの残りの失敗は数えない。
  if (Date.now() < restartQuietUntil) return;

  const now = Date.now();
  if (!shouldRestartNow({ now, lastRestartAt: lastWebRestartAt, minIntervalMs: STUCK_RESTART_MIN_INTERVAL_MS })) {
    // 同じ失敗が続いている間、案内を毎行出さない（出力が埋もれる）。
    if (lastStuckNoticeAt !== null && now - lastStuckNoticeAt < STUCK_RESTART_MIN_INTERVAL_MS) return;
    lastStuckNoticeAt = now;
    console.error(
      "[web] ビルドの失敗が続いています。`Remove-Item -Recurse -Force .next` のあと、`npm run dev` をやり直してください。",
    );
    return;
  }

  console.error("[web] ファイルが一時的に掴まれてビルドが止まりました。開発サーバーを立て直します（数秒で戻ります）。");
  restartTimer = setTimeout(() => {
    restartTimer = null;
    lastWebRestartAt = Date.now();
    stoppingWeb = true;
    killTree(webChild);
    webChild = startWeb();
  }, STUCK_RESTART_DELAY_MS);
  restartQuietUntil = now + STUCK_RESTART_DELAY_MS + STUCK_RESTART_GRACE_MS;
  restartTimer.unref?.();
}

function startWeb() {
  return launch("web", "npm run dev:web", root, { watchOutput: true, onLine: (line) => {
    if (isStuckBuildLine(line)) onStuckBuild();
  } });
}

function shutdown() {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function flyerPython() {
  const win = process.platform === "win32";
  const venvPython = path.join(
    root,
    "services",
    "flyer",
    ".venv",
    win ? "Scripts" : "bin",
    win ? "python.exe" : "python",
  );
  // パスに空白や日本語が混ざるので、venv があるときは引用符で囲む。
  return existsSync(venvPython) ? JSON.stringify(venvPython) : "python";
}

if (await listening(8000)) {
  console.log("[flyer] 127.0.0.1:8000 は既に起動しています。そのまま使います（Docker の flyer かもしれません）");
} else {
  launch(
    "flyer",
    `${flyerPython()} -m uvicorn src.main:app --host 127.0.0.1 --port 8000`,
    path.join(root, "services", "flyer"),
  );
}

if (await listening(3012)) {
  console.error("[web] ポート 3012 は使用中です。Docker の web が動いていないか確認してください（docker compose down で止まります）。");
  shutdown();
} else {
  webChild = startWeb();
}
