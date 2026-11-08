import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isStaleCacheLine,
  isStaleResolution,
  isStuckBuildLine,
  shouldRestartNow,
  STUCK_RESTART_DELAY_MS,
  STUCK_RESTART_GRACE_MS,
  STUCK_RESTART_MIN_INTERVAL_MS,
} from "./lib/dev-stuck.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
/** `--clean` で起動したか。`.next` を消してから始める。 */
const cleanStart = process.argv.includes("--clean");

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
/**
 * `.next` を消して立て直した回数。作り直しは 1 回 30 秒ほどかかるので、
 * 同じ失敗が続くときは繰り返さず、手順を案内する。
 */
let cleanRestarts = 0;
const MAX_CLEAN_RESTARTS = 2;


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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `.next` を消す。消せたら true。
 *
 * Windows では、止めた直後の子がまだファイルを離していないことがある。数回試し、
 * それでも消せなければ起動だけは続ける（消せなくても、立て直しで直ることがある）。
 */
async function removeBuild() {
  const target = path.join(root, ".next");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (attempt === 5) {
        console.error(
          `[web] .next を消せませんでした（${error.code ?? error.message}）。起動は続けます。`,
        );
        return false;
      }
      await delay(500);
    }
  }
  return false;
}

/**
 * ビルドが「ファイルを掴まれて読めなかった」失敗で止まったとき、開発サーバーを立て直す。
 *
 * この失敗は Turbopack が覚えたままで、以後どの URL も 500 を返し続ける（再起動だけが効く）。
 * OneDrive の下の作業ツリーでは、保存の直後に一時的な掴みが起きうる。
 * 原因が手元のコードにある失敗（構文エラーなど）は、ここでは拾わない。
 *
 * `clean` のときは、止めてから `.next` も消す。git の切り替えやマージのあとに残る
 * 「ディスクにはあるのに解決できない」失敗は、作り直さないと直らない。
 */
function onStuckBuild({ clean = false } = {}) {
  if (shuttingDown || restartTimer) return;
  // 立て直した直後に流れてくる、前のプロセスの残りの失敗は数えない。
  if (Date.now() < restartQuietUntil) return;

  const now = Date.now();
  if (!shouldRestartNow({ now, lastRestartAt: lastWebRestartAt, minIntervalMs: STUCK_RESTART_MIN_INTERVAL_MS })) {
    // 同じ失敗が続いている間、案内を毎行出さない（出力が埋もれる）。
    if (lastStuckNoticeAt !== null && now - lastStuckNoticeAt < STUCK_RESTART_MIN_INTERVAL_MS) return;
    lastStuckNoticeAt = now;
    console.error(
      "[web] ビルドの失敗が続いています。`npm run dev:clean`（.next を消して起動）をやり直してください。",
    );
    return;
  }
  if (clean && cleanRestarts >= MAX_CLEAN_RESTARTS) {
    if (lastStuckNoticeAt !== null && now - lastStuckNoticeAt < STUCK_RESTART_MIN_INTERVAL_MS) return;
    lastStuckNoticeAt = now;
    console.error(
      "[web] .next を作り直しても直りません。`npm run dev:clean` で起動し直し、それでも駄目ならエラーの全文を見せてください。",
    );
    return;
  }

  console.error(
    clean
      ? "[web] ビルドのキャッシュが古いまま残っています。.next を消して開発サーバーを立て直します（30 秒ほどかかります）。"
      : "[web] ファイルが一時的に掴まれてビルドが止まりました。開発サーバーを立て直します（数秒で戻ります）。",
  );
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    lastWebRestartAt = Date.now();
    stoppingWeb = true;
    killTree(webChild);
    if (clean) {
      cleanRestarts += 1;
      await removeBuild();
    }
    webChild = startWeb();
  }, STUCK_RESTART_DELAY_MS);
  restartQuietUntil = now + STUCK_RESTART_DELAY_MS + STUCK_RESTART_GRACE_MS;
  restartTimer.unref?.();
}

/**
 * 受け取った 1 行を見て、立て直すべき失敗かを決める。
 *
 * 掴まれて読めなかった失敗は再起動だけで戻る。`.next` の食い違いは、消してから
 * 起動し直す必要がある。どちらも、対象がディスクにあることを確かめてから動く。
 */
function onBuildLine(line) {
  if (isStuckBuildLine(line)) {
    onStuckBuild();
    return;
  }
  if (isStaleCacheLine(line)) {
    onStuckBuild({ clean: true });
    return;
  }
  if (isStaleResolution(line, { root, exists: existsSync })) onStuckBuild({ clean: true });
}

function startWeb() {
  return launch("web", "npm run dev:web", root, { watchOutput: true, onLine: onBuildLine });
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
  // 起動方式を変えたときや、`.next` の作りが食い違って直らないときは `--clean` で始める。
  if (cleanStart) {
    console.log("[web] .next を消してから起動します（作り直しに 30 秒ほどかかります）。");
    await removeBuild();
  }
  webChild = startWeb();
}
